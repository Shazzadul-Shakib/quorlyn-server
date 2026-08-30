-- Quiz links are now hard-deleted instead of soft-revoked (see
-- QuizLinkRepository.remove) — this column no longer has a writer.
ALTER TABLE "QuizLink" DROP COLUMN "revokedAt";
