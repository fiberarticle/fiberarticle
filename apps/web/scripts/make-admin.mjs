/**
 * Make someone an admin from the command line.
 *
 * This exists only to solve the first-admin problem: the Admin page can promote
 * anyone, but you have to already be an admin to open it. So the very first one
 * has to be set from outside the product. After that, use the page.
 *
 *   node scripts/make-admin.mjs someone@example.com
 *   node scripts/make-admin.mjs someone@example.com --remove
 *
 * It reads DATABASE_URL from apps/web/.env, the same connection the app uses.
 */

import { PrismaClient } from "@prisma/client";

const email = process.argv[2]?.trim().toLowerCase();
const remove = process.argv.includes("--remove");

if (!email) {
  console.error("Usage: node scripts/make-admin.mjs <email> [--remove]");
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, name: true, email: true, role: true },
  });

  if (!user) {
    console.error(
      `No account found for ${email}. Sign up in the app first, then run this again.`
    );
    process.exit(1);
  }

  const role = remove ? "user" : "admin";

  if (user.role === role) {
    console.log(`${user.email} is already ${role}. Nothing to do.`);
    process.exit(0);
  }

  await prisma.user.update({ where: { id: user.id }, data: { role } });

  // Taking admin away has to bite at once. The role is copied into the signed
  // token, so an existing session would keep it until that token expired.
  if (remove) {
    const { count } = await prisma.session.deleteMany({
      where: { userId: user.id },
    });
    console.log(`Removed admin from ${user.email}. Signed out ${count} session(s).`);
  } else {
    // Same reason in reverse: their current token still says "user", so they
    // must sign in again to get one that says admin.
    const { count } = await prisma.session.deleteMany({
      where: { userId: user.id },
    });
    console.log(
      `${user.email} is now an admin. Signed out ${count} session(s) - sign in again to pick it up.`
    );
  }
} finally {
  await prisma.$disconnect();
}
