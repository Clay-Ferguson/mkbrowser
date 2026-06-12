/**
 * Avatar graphics for the AI Chat thread view.
 *
 * Each avatar is defined ONCE as an SVG <symbol> inside ThreadAvatarDefs,
 * and every conversation turn renders only a tiny <svg><use/></svg> reference
 * to it.  This keeps the DOM cost negligible even with a hundred turns on
 * screen at once — the browser rasterizes the shared symbol, not a fresh
 * copy of the artwork per row.
 */

/**
 * Hidden SVG block holding the avatar artwork as reusable symbols.
 * Render this exactly once, anywhere inside the thread view.
 */
export function ThreadAvatarDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="thread-avatar-clip">
          <circle cx="32" cy="32" r="30" />
        </clipPath>

        {/* ---- Human: friendly face in a blue badge ---- */}
        <symbol id="thread-avatar-human" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="30" fill="#1e293b" />
          <g clipPath="url(#thread-avatar-clip)">
            {/* shoulders / shirt */}
            <path
              d="M 3 64 Q 5 45 32 45 Q 59 45 61 64 Z"
              fill="#2563eb"
            />
            {/* collar */}
            <path d="M 24.5 46 L 32 54 L 39.5 46 Z" fill="#1d4ed8" />
            {/* neck */}
            <rect x="25" y="39" width="14" height="10" rx="3" fill="#e3a87c" />
            {/* ears — drawn behind the head so the inner half is hidden,
                leaving a proportional ear protruding on each side */}
            <ellipse cx="18.6" cy="28.5" rx="2.2" ry="3.4" fill="#f2c79d" />
            <ellipse cx="45.4" cy="28.5" rx="2.2" ry="3.4" fill="#f2c79d" />
            <path d="M 17.8 27 Q 16.9 28.5 17.8 30" stroke="#d9a16f" strokeWidth="1" fill="none" strokeLinecap="round" />
            <path d="M 46.2 27 Q 47.1 28.5 46.2 30" stroke="#d9a16f" strokeWidth="1" fill="none" strokeLinecap="round" />
            {/* head — squared jaw tapering to a defined chin */}
            <path
              d="M 19 24 Q 19 10.5 32 10.5 Q 45 10.5 45 24 L 45 29
                 Q 45 36.5 40.5 40.5 Q 36.5 44 32 44 Q 27.5 44 23.5 40.5
                 Q 19 36.5 19 29 Z"
              fill="#f2c79d"
            />
            {/* hair */}
            <path
              d="M 19 26 Q 18 9 32 9 Q 46 9 45 26
                 Q 45 18.5 40 17 Q 34 15.5 28.5 17.5 Q 19.5 19 19 26 Z"
              fill="#6b4a2b"
            />
            {/* eyebrows */}
            <path d="M 23 23.5 Q 26 21.6 29 23.2" stroke="#5d4126" strokeWidth="2.1" fill="none" strokeLinecap="round" />
            <path d="M 35 23.2 Q 38 21.6 41 23.5" stroke="#5d4126" strokeWidth="2.1" fill="none" strokeLinecap="round" />
            {/* eyes */}
            <circle cx="26.2" cy="27.5" r="1.9" fill="#2b2b2b" />
            <circle cx="37.8" cy="27.5" r="1.9" fill="#2b2b2b" />
            {/* nose */}
            <path d="M 32 29 Q 30.8 33 32.6 33.6" stroke="#d9a16f" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            {/* smile */}
            <path d="M 27 36.2 Q 32 39 37 36.2" stroke="#b06a3f" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </g>
          <circle cx="32" cy="32" r="30" fill="none" stroke="#3b82f6" strokeWidth="2.5" />
        </symbol>

        {/* ---- AI: robot head in an emerald badge ---- */}
        <symbol id="thread-avatar-robot" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="30" fill="#1e293b" />
          <g clipPath="url(#thread-avatar-clip)">
            {/* antenna */}
            <line x1="32" y1="14" x2="32" y2="8.5" stroke="#94a3b8" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="32" cy="7.5" r="2.8" fill="#34d399" />
            {/* side "ears" */}
            <rect x="12.5" y="25" width="5" height="12" rx="2" fill="#64748b" />
            <rect x="46.5" y="25" width="5" height="12" rx="2" fill="#64748b" />
            {/* head */}
            <rect x="17" y="14" width="30" height="32" rx="7" fill="#94a3b8" />
            <rect x="17" y="14" width="30" height="32" rx="7" fill="none" stroke="#64748b" strokeWidth="1.5" />
            {/* face plate */}
            <rect x="21" y="20" width="22" height="15" rx="4" fill="#334155" />
            {/* glowing eyes */}
            <circle cx="27.5" cy="27.5" r="3.4" fill="#34d399" />
            <circle cx="36.5" cy="27.5" r="3.4" fill="#34d399" />
            <circle cx="26.5" cy="26.5" r="1.1" fill="#d1fae5" />
            <circle cx="35.5" cy="26.5" r="1.1" fill="#d1fae5" />
            {/* mouth grille */}
            <rect x="25" y="38.5" width="2.8" height="4" rx="1" fill="#475569" />
            <rect x="30.6" y="38.5" width="2.8" height="4" rx="1" fill="#475569" />
            <rect x="36.2" y="38.5" width="2.8" height="4" rx="1" fill="#475569" />
            {/* neck / torso hint */}
            <rect x="26" y="46" width="12" height="6" rx="2" fill="#64748b" />
            <path d="M 14 64 Q 14 50 32 50 Q 50 50 50 64 Z" fill="#475569" />
            <circle cx="32" cy="57" r="3" fill="#34d399" opacity="0.85" />
          </g>
          <circle cx="32" cy="32" r="30" fill="none" stroke="#10b981" strokeWidth="2.5" />
        </symbol>
      </defs>
    </svg>
  );
}

interface ThreadAvatarProps {
  role: 'human' | 'ai';
}

/**
 * A ~50px avatar shown to the left of each conversation turn so the reader
 * can tell human vs AI turns at a glance.  Renders only a <use> reference;
 * the artwork itself lives in ThreadAvatarDefs.
 */
function ThreadAvatar({ role }: ThreadAvatarProps) {
  return (
    <svg
      className="w-[50px] h-[50px] flex-shrink-0"
      viewBox="0 0 64 64"
      role="img"
      aria-label={role === 'human' ? 'Human' : 'AI'}
    >
      <use href={role === 'human' ? '#thread-avatar-human' : '#thread-avatar-robot'} />
    </svg>
  );
}

export default ThreadAvatar;
