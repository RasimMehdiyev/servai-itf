#!/usr/bin/env python3
"""
Serve a robot's log file as a WebSocket stream, for the ServAI relay to connect to.

Run it ON THE ROBOT'S MACHINE (Python 3 only, no packages needed):

    python3 robot-log-stream.py ~/demos/CriticBarista/airo-barista/scripts/bar_demo.log --port 7878

and point the relay at it:

    ROBOT_WS_BAR=ws://armadillo.local:7878 npm run relay:bar

It does what `tail -f bar_demo.log | grep -E ' \\| (SYSTEM|WORKFLOW) \\| '` does, but over a WebSocket:
every line appended to the file is sent to every connected client as one text frame. Clients get new
lines only (nothing is replayed on connect, so an order is never counted twice); use --replay N to
send the last N matching lines first, for testing.

    --port N        port to listen on (default 7878)
    --pattern RE    only send lines matching RE (default: the structured log lines ' \\| (SYSTEM|WORKFLOW) \\| ',
                    the AI Judge's lines (the critic-service process) and the arm controller's fault lines;
                    IMAGE lines are always sent). Use --pattern '' to send everything.
    --replay N      send the last N matching lines to each new client
    --from-start    read the file from its beginning instead of from its end

The file may be rotated or truncated while this runs; it is reopened when that happens.

Instead of a file, "-" reads the log from standard input, so a program's output can be streamed as it is
printed (the aggregated output of the grocery robot's `grocery-up`, say) while it keeps showing in the terminal:

    uv run grocery-up --no-rerun 2>&1 | tee grocery-up.log | python3 robot-log-stream.py - --port 7878
"""
import argparse
import base64
import hashlib
import os
import re
import socket
import struct
import sys
import threading
import time

GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
# The structured lines are what the dashboard is built on. The AI Judge (an independent camera + VLM) logs
# through its own process: its phase changes, the check it runs, the question it asked and the YES/NO it
# answered. The arm controller's faults have no timestamp or level at all, but explain a failed handover.
DEFAULT_PATTERN = (
    r" \| (SYSTEM|WORKFLOW) \| "
    r"|^\[critic-service\]"
    r"|__main__:_(run_fast_check|process_fast_checks|update_state|drain_state):"
    r"|^\[\{'role'|^>\s*`(YES|NO)`"
    r"|FRC_SystemFault|(FanucDriverExecutor|airo_fanuc|RMI):"
)


def frame(payload: bytes, opcode: int = 0x1) -> bytes:
    """One unmasked server frame."""
    n = len(payload)
    if n < 126:
        head = struct.pack("!BB", 0x80 | opcode, n)
    elif n < 65536:
        head = struct.pack("!BBH", 0x80 | opcode, 126, n)
    else:
        head = struct.pack("!BBQ", 0x80 | opcode, 127, n)
    return head + payload


class Client(threading.Thread):
    def __init__(self, conn, addr, hub):
        super().__init__(daemon=True)
        self.conn, self.addr, self.hub = conn, addr, hub
        self.lock = threading.Lock()
        self.alive = True

    def send(self, data: bytes):
        with self.lock:
            try:
                self.conn.sendall(data)
            except OSError:
                self.alive = False

    def run(self):
        try:
            if not self.handshake():
                return
            self.hub.add(self)
            print(f"client connected: {self.addr[0]}:{self.addr[1]} ({len(self.hub.clients)} total)", flush=True)
            self.read_loop()
        except OSError:
            pass
        finally:
            self.alive = False
            self.hub.remove(self)
            try:
                self.conn.close()
            except OSError:
                pass
            print(f"client left: {self.addr[0]}:{self.addr[1]} ({len(self.hub.clients)} total)", flush=True)

    def handshake(self) -> bool:
        data = b""
        self.conn.settimeout(5)
        while b"\r\n\r\n" not in data and len(data) < 8192:
            chunk = self.conn.recv(1024)
            if not chunk:
                return False
            data += chunk
        key = re.search(rb"Sec-WebSocket-Key:\s*(\S+)", data, re.I)
        if not key:
            self.conn.sendall(b"HTTP/1.1 426 Upgrade Required\r\nContent-Length: 0\r\n\r\n")
            return False
        accept = base64.b64encode(hashlib.sha1(key.group(1) + GUID).digest())
        self.conn.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                          b"Sec-WebSocket-Accept: " + accept + b"\r\n\r\n")
        self.conn.settimeout(None)
        return True

    def recv_exact(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = self.conn.recv(n - len(buf))
            if not chunk:
                raise OSError("closed")
            buf += chunk
        return buf

    def read_loop(self):
        # Clients only ever send pings, pongs or a close; read them so the socket stays healthy.
        while self.alive:
            b1, b2 = self.recv_exact(2)
            opcode, masked, n = b1 & 0x0F, b2 & 0x80, b2 & 0x7F
            if n == 126:
                n = struct.unpack("!H", self.recv_exact(2))[0]
            elif n == 127:
                n = struct.unpack("!Q", self.recv_exact(8))[0]
            mask = self.recv_exact(4) if masked else b""
            payload = self.recv_exact(n) if n else b""
            if masked:
                payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
            if opcode == 0x8:      # close
                self.send(frame(payload, 0x8))
                return
            if opcode == 0x9:      # ping → pong
                self.send(frame(payload, 0xA))


class Hub:
    def __init__(self):
        self.clients = []
        self.lock = threading.Lock()

    def add(self, c):
        with self.lock:
            self.clients.append(c)

    def remove(self, c):
        with self.lock:
            if c in self.clients:
                self.clients.remove(c)

    def broadcast(self, line: str):
        data = frame(line.encode("utf-8", "replace"))
        with self.lock:
            clients = list(self.clients)
        for c in clients:
            c.send(data)


def tail(path, hub, keep, from_start):
    """Follow the file, surviving rotation and truncation."""
    f = None
    inode = None
    pos = 0
    started = False
    while True:
        try:
            st = os.stat(path)
        except FileNotFoundError:
            time.sleep(0.5)
            continue
        if f is None or st.st_ino != inode or st.st_size < pos:
            if f:
                f.close()
            f = open(path, "r", encoding="utf-8", errors="replace")
            inode = st.st_ino
            if not started and not from_start:
                f.seek(0, os.SEEK_END)
            started = True
            pos = f.tell()
        line = f.readline()
        if not line:
            time.sleep(0.1)
            pos = f.tell()
            continue
        pos = f.tell()
        if not line.endswith("\n"):          # half-written line: wait for the rest
            f.seek(pos - len(line.encode("utf-8", "replace")))
            time.sleep(0.1)
            continue
        line = line.rstrip("\r\n")
        keep(line)


def read_stdin(keep):
    """Feed every line read from standard input to the stream (the input ends when the program does)."""
    try:
        sys.stdin.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    for line in sys.stdin:
        keep(line.rstrip("\r\n"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("logfile")
    ap.add_argument("--port", type=int, default=7878)
    ap.add_argument("--pattern", default=DEFAULT_PATTERN)
    ap.add_argument("--replay", type=int, default=0)
    ap.add_argument("--from-start", action="store_true")
    args = ap.parse_args()

    pattern = re.compile(args.pattern) if args.pattern else None
    image = re.compile(r"^\S+\s*\|\s*IMAGE\s*\|")
    hub = Hub()
    recent = []

    def keep(line):
        if pattern and not (pattern.search(line) or image.search(line)):
            return
        recent.append(line)
        del recent[:-max(args.replay, 1)]
        hub.broadcast(line)

    if args.logfile == "-":
        threading.Thread(target=read_stdin, args=(keep,), daemon=True).start()
    else:
        threading.Thread(target=tail, args=(args.logfile, hub, keep, args.from_start), daemon=True).start()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", args.port))
    srv.listen(8)
    print(f"streaming {'standard input' if args.logfile == '-' else args.logfile} on ws://0.0.0.0:{args.port}"
          f"{'' if not pattern else '  (lines matching ' + args.pattern + ')'}", flush=True)
    while True:
        conn, addr = srv.accept()
        c = Client(conn, addr, hub)
        c.start()
        if args.replay:
            def replay(client=c, lines=list(recent[-args.replay:])):
                time.sleep(0.3)
                for l in lines:
                    client.send(frame(l.encode("utf-8", "replace")))
            threading.Thread(target=replay, daemon=True).start()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
