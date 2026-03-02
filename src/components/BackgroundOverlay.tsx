interface BackgroundOverlayProps {
  imageDataUrl?: string;
  opacity: number;
}

export function BackgroundOverlay({ imageDataUrl, opacity }: BackgroundOverlayProps) {
  if (!imageDataUrl) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `url("${imageDataUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        opacity: opacity / 100,
      }}
    />
  );
}
