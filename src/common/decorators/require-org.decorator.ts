import { SetMetadata } from '@nestjs/common';

export const REQUIRE_ORG_KEY = 'requireOrg';

/** Marks a route as org-scoped without constraining role or permissions. */
export const RequireOrg = () => SetMetadata(REQUIRE_ORG_KEY, true);
