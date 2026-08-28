"use client";

export function ViewportAtmosphere() {
  return (
    <div className="viewport-atmosphere" aria-hidden>
      <div className="viewport-atmosphere__aurora" />
      <div className="viewport-atmosphere__stars" />
      <div className="viewport-atmosphere__grid" />
    </div>
  );
}
