import { Route, Routes } from 'react-router-dom'
import { BattlegroundSelectorPage } from './pages/BattlegroundSelectorPage'
import { PlansPage } from './pages/PlansPage'
import { SettingsPage } from './pages/SettingsPage'
import { UnitsPage } from './pages/UnitsPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<BattlegroundSelectorPage />} />
      <Route path="/plans" element={<PlansPage />} />
      <Route path="/units" element={<UnitsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  )
}

export default App
