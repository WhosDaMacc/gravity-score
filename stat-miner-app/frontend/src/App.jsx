import React from "react";
import SportTile from "./SportTile";

const Dashboard = () => {
  const mockData = [
    {
      id: 1,
      sport: "UFC",
      uvs: 88,
      edgeAlert: true,
      details: {
        matchup: "Jones vs Miocic",
        stats: { StrAcc: "58%", TDDef: "72%" },
      },
    },
    {
      id: 2,
      sport: "NBA",
      uvs: 42,
      edgeAlert: false,
      details: {
        matchup: "Lakers vs Celtics",
        stats: { Gravity: "9.2", xA: "11.5" },
      },
    },
    {
      id: 3,
      sport: "Horse Racing",
      uvs: 91,
      edgeAlert: true,
      details: {
        matchup: "Churchill Downs R4",
        stats: { Speed: "104", Track: "Fast" },
      },
    },
    {
      id: 4,
      sport: "F1",
      uvs: 65,
      edgeAlert: false,
      details: {
        matchup: "Monaco GP",
        stats: { Tires: "Hard", Lap: "22/78" },
      },
    },
  ];

  return (
    <div className="min-h-screen bg-black p-8 font-sans text-slate-200">
      <header className="mb-12">
        <h1 className="text-4xl font-black italic tracking-tighter text-white">
          STAT MINING ENGINE <span className="text-green-500">v2.0</span>
        </h1>
        <p className="text-slate-500">Cross-Sport Universal Value Dashboard</p>
      </header>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {mockData.map((data) => (
          <SportTile key={data.id} {...data} />
        ))}
      </div>
    </div>
  );
};

export default Dashboard;

