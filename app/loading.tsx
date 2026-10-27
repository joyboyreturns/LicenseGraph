export default function Loading() {
  return (
    <div className="container" style={{ paddingTop: 48 }} aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ width: 140, height: 12 }} />
      <div className="skeleton" style={{ width: "min(620px, 90%)", height: 48, marginTop: 16 }} />
      <div className="skeleton" style={{ width: "min(460px, 70%)", height: 18, marginTop: 16 }} />
      <div className="skeleton" style={{ height: 320, marginTop: 32, borderRadius: 16 }} />
    </div>
  );
}
