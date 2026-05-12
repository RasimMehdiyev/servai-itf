"""Quick smoke test for the RAG server module."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.rag.server import (
    app, weekly_prompt, chart_prompt, orders_list_prompt, order_detail_prompt,
    compute_stats, read_orders, filter_by_date, today_str, week_ago_str,
)

orders = read_orders()
print(f"Orders loaded: {len(orders)}")

filtered = filter_by_date(orders, week_ago_str(), today_str())
print(f"Filtered to last week: {len(filtered)}")

stats = compute_stats(filtered)
stats["start_date"] = week_ago_str()
stats["end_date"] = today_str()
print(f"Stats: {stats['total']} total, {stats['success']} ok, {stats['failed']} failed")
print(f"Busiest: {stats.get('busiest_day')}, Slowest: {stats.get('slowest')}")

wp = weekly_prompt(stats)
print(f"Weekly prompt: {len(wp['user'])} chars - OK")

cp = chart_prompt(stats)
print(f"Chart prompt: {len(cp['user'])} chars - OK")

olp = orders_list_prompt(stats, "all")
print(f"Orders list prompt: {len(olp['user'])} chars - OK")

if stats.get("slowest"):
    order = next((o for o in orders if o.get("id") == stats["slowest"]["id"]), None)
    if order:
        odp = order_detail_prompt(order)
        print(f"Order detail prompt: {len(odp['user'])} chars - OK")

# Check routes
routes = [(r.methods, r.path) for r in app.routes if hasattr(r, "methods")]
print(f"\nRoutes registered: {len(routes)}")
for methods, path in routes:
    print(f"  {methods} {path}")

print("\nAll checks passed.")
