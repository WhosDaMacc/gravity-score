import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./style.css";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import HowItWorks from "./pages/HowItWorks";
import Landing from "./pages/Landing";
import Leaderboard from "./pages/Leaderboard";
import NotFound from "./pages/NotFound";
import Picks from "./pages/Picks";
import Player from "./pages/Player";
import Props from "./pages/Props";
import SportHub from "./pages/SportHub";
import Tracker from "./pages/Tracker";

ReactDOM.createRoot(document.getElementById("app") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Landing />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="players/:slug" element={<Player />} />
          <Route path="props" element={<Props />} />
          <Route path="picks" element={<Picks />} />
          <Route path="history" element={<History />} />
          <Route path="tracker" element={<Tracker />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="sports/:sport" element={<SportHub />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
