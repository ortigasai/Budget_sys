CREATE TABLE "UserGroupMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "UserGroupMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserGroupMembership_userId_group_scope_key" ON "UserGroupMembership"("userId", "group", "scope");

ALTER TABLE "UserGroupMembership" ADD CONSTRAINT "UserGroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
