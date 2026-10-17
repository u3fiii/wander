// The Wander mark: a little green planet with a road looping round it and a red car on the near side of the
// loop (the same picture as the loading screen). The back of the road passes behind the planet.
export function LogoMark({ size = 40 }: { size?: number }) {
  return <svg className="logo-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <defs>
      <radialGradient id="logo-planet" cx="0.36" cy="0.32" r="0.75">
        <stop offset="0" stopColor="#a6dca2" />
        <stop offset="0.5" stopColor="#5aa57a" />
        <stop offset="1" stopColor="#2b6a5d" />
      </radialGradient>
    </defs>
    <g transform="rotate(-16 20 21)">
      <path d="M3 21 A17 6.5 0 0 1 37 21" fill="none" stroke="#e9dfbf" strokeWidth="2.6" strokeLinecap="round" />
    </g>
    <circle cx="20" cy="21" r="12" fill="url(#logo-planet)" />
    <path d="M13.5 13.5a9 9 0 0 1 6-3" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
    <g transform="rotate(-16 20 21)">
      <path d="M3 21 A17 6.5 0 0 0 37 21" fill="none" stroke="#f6efd8" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M5 21 A15.2 5 0 0 0 35 21" fill="none" stroke="#c9b98a" strokeWidth="0.6" strokeDasharray="1.6 1.8" />
      <g transform="translate(28.6 26.3) rotate(-14)">
        <rect x="-3.4" y="-2.6" width="6.8" height="3.6" rx="1.2" fill="#d9604c" />
        <rect x="-1.6" y="-3.9" width="3.6" height="1.8" rx="0.8" fill="#d9604c" />
        <circle cx="-1.9" cy="1.1" r="1" fill="#1f2a2c" /><circle cx="1.9" cy="1.1" r="1" fill="#1f2a2c" />
      </g>
    </g>
  </svg>;
}
