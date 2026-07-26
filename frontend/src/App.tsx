import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { WalletProvider } from './state/wallet';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Create } from './pages/Create';
import { Agreements } from './pages/Agreements';
import { AgreementPage } from './pages/AgreementPage';
import { Invite } from './pages/Invite';
import { Demo } from './pages/Demo';
import { Help, Privacy, Terms, NotFound } from './pages/Content';

/** Scrolls to top on route change and routes the app. */
export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <WalletProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Home />} />
              <Route path="/create" element={<Create />} />
              <Route path="/agreements" element={<Agreements />} />
              <Route path="/agreement/:contractAddress" element={<AgreementPage />} />
              <Route path="/invite/:contractAddress" element={<Invite />} />
              <Route path="/demo" element={<Demo />} />
              <Route path="/help" element={<Help />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/index.html" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </WalletProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
