import { Route, Routes } from 'react-router-dom'
import { BattlegroundSelectorPage } from './pages/BattlegroundSelectorPage'
import { PlansPage } from './pages/PlansPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<BattlegroundSelectorPage />} />
      <Route path="/plans" element={<PlansPage />} />
    </Routes>
  )
}

export default App
