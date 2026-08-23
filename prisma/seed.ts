import { PlatformRole, PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/utils/password.util';

async function main() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be set to seed the superadmin',
    );
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    // The superadmin holds no membership — tenancy lives on Membership now
    // (ADR-0006) and platform authority lives on the user row.
    const superadmin = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        passwordHash,
        platformRole: PlatformRole.SUPERADMIN,
        singleDeviceEnforced: false,
      },
      update: {
        passwordHash,
        platformRole: PlatformRole.SUPERADMIN,
        singleDeviceEnforced: false,
      },
    });
    console.log(`Superadmin ready: ${superadmin.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
