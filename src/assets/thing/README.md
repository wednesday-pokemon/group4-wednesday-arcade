# Thing portrait

Put the supplied Thing image in this folder, ideally named `thing.png` (any of png, jpg, jpeg, webp, avif or svg
works). The prologue (`src/ui/mystery/ThingPrologue.tsx`) uses this exact image for the narrator portrait, the
dialogue chip and the guide icon. A transparent background looks best; the image is shown inside a round lantern frame
and is never cropped tighter than `object-fit: contain`.

With no image here, the prologue falls back to the line-art `ThingSigil`.
