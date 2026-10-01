-- AlterTable
ALTER TABLE "users" ADD COLUMN     "staffOrganizerId" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_staffOrganizerId_fkey" FOREIGN KEY ("staffOrganizerId") REFERENCES "organizers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
