import React from "react";

export const LogoMark: React.FC<{ className?: string }> = ({ className = "h-7 w-7" }) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
    <defs>
      <radialGradient id="gs-core" cx="40%" cy="35%" r="70%">
        <stop offset="0%" stopColor="#6ee7b7" />
        <stop offset="100%" stopColor="#059669" />
      </radialGradient>
    </defs>
    <ellipse cx="16" cy="16" rx="14" ry="6" fill="none" stroke="#5eead4" strokeOpacity="0.55" strokeWidth="1.6" transform="rotate(-28 16 16)" />
    <circle cx="16" cy="16" r="7" fill="url(#gs-core)" />
    <circle cx="27.2" cy="10" r="1.9" fill="#f8fafc" />
  </svg>
);

const Logo: React.FC = () => (
  <span className="flex items-center gap-2">
    <LogoMark />
    <span className="text-lg font-black tracking-tight text-white">
      Gravity<span className="text-emerald-400">Score</span>
    </span>
  </span>
);

export default Logo;
