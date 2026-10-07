import { Migration } from '@mikro-orm/migrations';

export class Migration20261007215216TransactionResponseBalance extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "wager_transactions" add column "response_balance_amount" numeric(20,2) null, add column "response_balance_currency" text null;`,
    );
    this.addSql(`
      update "wager_transactions" as tx
      set "response_balance_amount" = coalesce(
            (select entry."balance_after_amount"
             from "wallet_ledger_entries" as entry
             where entry."transaction_id" = tx."id"
               and entry."wallet_id" = tx."wallet_id"
             limit 1),
            (select entry."balance_after_amount"
             from "wallet_ledger_entries" as entry
             where entry."wallet_id" = tx."wallet_id"
               and entry."created_at" <= coalesce(tx."processed_at", tx."created_at")
             order by entry."created_at" desc, entry."id" desc
             limit 1),
            0
          ),
          "response_balance_currency" = tx."currency";
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "wager_transactions" drop column "response_balance_amount", drop column "response_balance_currency";`,
    );
  }
}
