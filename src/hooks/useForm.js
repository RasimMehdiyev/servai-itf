import {useState, useCallback} from 'react'

export default function useForm(initial={}){
  const [values, setValues] = useState(initial)

  const handleChange = useCallback((e)=>{
    const {name, value} = e.target
    setValues(v=> ({...v, [name]: value}))
  },[])

  const reset = useCallback(()=> setValues(initial), [initial])

  return {values, setValues, handleChange, reset}
}
