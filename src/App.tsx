import { Routes, Route } from 'react-router'
import Whiteboard from '@app/whiteboard.tsx'

function App() {

  return (
    <Routes>
      <Route path="/" element={<Whiteboard />} />
      <Route path="/about" element={<div>About Page</div>} />
      <Route path="/contact" element={<div>Contact Page</div>} />
    </Routes>
  )
}

export default App
