import React from "react";
import { Link } from "react-router-dom";
import { useDocumentTitle } from "../lib/hooks";

const NotFound: React.FC = () => {
  useDocumentTitle("Page not found");
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="text-6xl font-black text-slate-700">404</p>
      <h1 className="mt-4 text-2xl font-bold text-white">This page drifted out of orbit</h1>
      <p className="mt-2 text-slate-400">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link to="/" className="mt-6 inline-block rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400">
        Back home
      </Link>
    </div>
  );
};

export default NotFound;
