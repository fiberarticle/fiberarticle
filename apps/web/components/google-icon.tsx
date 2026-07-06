import { siGoogle } from "simple-icons";

export function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-hidden
    >
      <path d={siGoogle.path} />
    </svg>
  );
}
