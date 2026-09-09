import { Navigate, Route, Routes } from 'react-router-dom'
import { BattlegroundSelectorPage } from './pages/BattlegroundSelectorPage'
import { PlansPage } from './pages/PlansPage'
import { SettingsPage } from './pages/SettingsPage'
import { UnitsPage } from './pages/UnitsPage'
import { IntelPage } from './pages/IntelPage'
import { RouteStudiesPage } from './pages/RouteStudiesPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/route-studies" replace />} />
      <Route path="/battleground" element={<BattlegroundSelectorPage />} />
      <Route path="/plans" element={<PlansPage />} />
      <Route path="/units" element={<UnitsPage />} />
      <Route path="/route-studies" element={<RouteStudiesPage />} />
      <Route path="/intel" element={<IntelPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>
  )
}

export default App
