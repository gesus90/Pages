-- Existing accounts keep their initials avatar through the safe default.
ALTER TABLE users ADD COLUMN avatar_type TEXT NOT NULL DEFAULT 'initials' CHECK (
    avatar_type IN ('initials', 'icon', 'image')
);
ALTER TABLE users ADD COLUMN avatar_icon TEXT;
ALTER TABLE users ADD COLUMN avatar_color TEXT;
ALTER TABLE users ADD COLUMN avatar_image_url TEXT;