import { Route, Routes } from 'react-router-dom'
import { BattlegroundSelectorPage } from './pages/BattlegroundSelectorPage'
import { PlansPage } from './pages/PlansPage'
import { SettingsPage } from './pages/SettingsPage'
import { UnitsPage } from './pages/UnitsPage'
import { IntelPage } from './pages/IntelPage'
import { SimulationsPage } from './pages/SimulationsPage'
import { ConclusionPage } from './pages/ConclusionPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<BattlegroundSelectorPage />} />
      <Route path="/plans" element={<PlansPage />} />
      <Route path="/simulations" element={<SimulationsPage />} />
      <Route path="/simulations/:batchId" element={<ConclusionPage />} />
      <Route path="/units" element={<UnitsPage />} />
      <Route path="/intel" element={<IntelPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  )
}

export default App
