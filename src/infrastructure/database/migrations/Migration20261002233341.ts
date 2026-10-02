import { Migration } from '@mikro-orm/migrations';

export class Migration20261002233341 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "wager_transactions" add column "reference_attempts" int not null default 0, add column "reference_next_attempt_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "wager_transactions" drop column "reference_attempts", drop column "reference_next_attempt_at";`);
  }

}
