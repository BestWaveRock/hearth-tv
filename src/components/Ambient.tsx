/**
 * The ambient backdrop.
 *
 * Three slow-drifting gradient blobs, a grain layer and a vignette. All of it
 * is CSS — no images to download, no canvas to keep repainting — so it costs
 * essentially nothing while giving the interface the warmth a media room wants.
 */
export function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient__blob ambient__blob--ember" />
      <div className="ambient__blob ambient__blob--rose" />
      <div className="ambient__blob ambient__blob--dusk" />
      <div className="ambient__grain" />
      <div className="ambient__vignette" />
    </div>
  );
}
