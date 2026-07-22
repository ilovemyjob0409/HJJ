export default function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="7.5" cy="8" r="5.4" fill="#F4F1EA" stroke="#2B2109" strokeWidth="0.8" />
      <circle cx="13" cy="12.5" r="5.4" fill="#241F18" />
    </svg>
  );
}
