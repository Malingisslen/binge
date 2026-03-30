export default function ProviderDot({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <span
      className="rounded-full shrink-0 inline-block"
      style={{ backgroundColor: color, width: size, height: size }}
    />
  );
}
