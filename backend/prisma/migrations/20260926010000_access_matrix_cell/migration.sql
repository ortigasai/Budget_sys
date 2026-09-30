CREATE TABLE "AccessMatrixCell" (
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,

    CONSTRAINT "AccessMatrixCell_pkey" PRIMARY KEY ("key","group")
);
