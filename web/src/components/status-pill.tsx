export function StatusPill({
  status,
  label,
  live = false,
}: {
  status: string;
  label?: string;
  live?: boolean;
}) {
  return (
    <span className={`status-pill ${status}`}>
      {live && <span className="livedot" aria-hidden />}
      {label ?? status}
    </span>
  );
}
