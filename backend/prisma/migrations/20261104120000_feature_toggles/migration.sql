-- Admin Console > Hidden Menus switches. No rows = everything stays hidden.
CREATE TABLE "FeatureToggle" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureToggle_pkey" PRIMARY KEY ("key")
);
