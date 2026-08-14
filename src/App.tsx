import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { Toaster } from "./components/ui/sonner";
import { ThemeProvider } from "./contexts/ThemeContext";
import { TimezoneProvider } from "./contexts/TimezoneContext";
import {
  AgentPage,
  ArchitecturePage,
  AutomationPage,
  ChartsPanelPage,
  CryptoPage,
  DashboardPage,
  ExperimentalPage,
  PerformanceTrackerPage,
  ResearchPage,
  RiskManagerPage,
  SettingsPage,
  SignalJournalPage,
  TradingIdeasPage,
} from "./pages";

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable={false}>
        <TimezoneProvider>
          <Toaster />
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/ideas" element={<TradingIdeasPage />} />
              <Route path="/journal" element={<SignalJournalPage />} />
              <Route path="/performance" element={<PerformanceTrackerPage />} />
              <Route path="/risk" element={<RiskManagerPage />} />
              <Route path="/automation" element={<AutomationPage />} />
              <Route path="/experimental" element={<ExperimentalPage />} />
              <Route path="/crypto" element={<CryptoPage />} />
              <Route path="/charts" element={<ChartsPanelPage />} />
              <Route path="/research" element={<ResearchPage />} />
              <Route path="/agent" element={<AgentPage />} />
              <Route path="/architecture" element={<ArchitecturePage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </TimezoneProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
