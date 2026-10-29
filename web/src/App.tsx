import { Navigate, Route, Routes } from 'react-router';

import { homeFor, useSession } from './auth/session';
import { Layout, RequireRole } from './components';
import { EventPage } from './pages/EventPage';
import { EventsPage } from './pages/EventsPage';
import { GatePage } from './pages/GatePage';
import { LoginPage } from './pages/LoginPage';
import { TicketPage } from './pages/TicketPage';

function Home() {
  const { user } = useSession();
  return <Navigate to={user ? homeFor(user) : '/login'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="login" element={<LoginPage />} />

        <Route element={<RequireRole role="ORGANIZER" />}>
          <Route path="events" element={<EventsPage />} />
          <Route path="events/:eventId" element={<EventPage />} />
          <Route path="tickets/:ticketId" element={<TicketPage />} />
        </Route>

        <Route element={<RequireRole role="SCANNER" />}>
          <Route path="gate" element={<GatePage />} />
        </Route>

        <Route path="*" element={<p className="note">There is nothing at this address.</p>} />
      </Route>
    </Routes>
  );
}
