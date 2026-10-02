import { Migration } from '@mikro-orm/migrations';

export class Migration20261002230147 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create type "wager_transaction_kind" as enum ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK');`);
    this.addSql(`create type "wager_transaction_status" as enum ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED');`);
    this.addSql(`create type "failure_code" as enum ('INSUFFICIENT_FUNDS', 'CURRENCY_MISMATCH', 'REFERENCE_NOT_FOUND', 'REFERENCE_INVALID', 'DUPLICATE_REVERSAL', 'AMOUNT_MISMATCH', 'NEGATIVE_BALANCE_REVERSAL', 'PAYLOAD_CONFLICT', 'INVALID_KIND', 'WALLET_NOT_FOUND', 'INTERNAL_ERROR');`);
    this.addSql(`create type "ledger_direction" as enum ('DEBIT', 'CREDIT');`);
    this.addSql(`create table "inbox_messages" ("message_id" text not null, "consumer_name" text not null, "payload_hash" text not null, "received_at" timestamptz not null, "processed_at" timestamptz null, constraint "inbox_messages_pkey" primary key ("message_id", "consumer_name"));`);
    this.addSql(`alter table "inbox_messages" add constraint "inbox_messages_consumer_name_message_id_unique" unique ("consumer_name", "message_id");`);

    this.addSql(`create table "outbox_messages" ("id" uuid not null, "aggregate_id" uuid not null, "event_type" text not null, "payload" jsonb not null, "occurred_at" timestamptz not null, "attempts" int not null, "next_attempt_at" timestamptz null, "published_at" timestamptz null, constraint "outbox_messages_pkey" primary key ("id"));`);
    this.addSql(`create index "outbox_messages_published_at_next_attempt_at_index" on "outbox_messages" ("published_at", "next_attempt_at");`);

    this.addSql(`create table "wager_transactions" ("id" uuid not null, "provider_id" text not null, "external_transaction_id" text not null, "idempotency_key" text not null, "payload_hash" text not null, "wallet_id" uuid not null, "player_id" uuid not null, "round_id" text not null, "game_id" text not null, "kind" "wager_transaction_kind" not null, "money_amount" numeric(20,2) not null, "currency" text not null, "reference_external_transaction_id" text null, "reference_transaction_id" uuid null, "status" "wager_transaction_status" not null, "failure_code" "failure_code" null, "processed_at" timestamptz null, "created_at" timestamptz not null, constraint "wager_transactions_pkey" primary key ("id"));`);
    this.addSql(`create index "wager_transactions_provider_id_reference_external__b8537_index" on "wager_transactions" ("provider_id", "reference_external_transaction_id");`);
    this.addSql(`create index "wager_transactions_wallet_id_index" on "wager_transactions" ("wallet_id");`);
    this.addSql(`create index "wager_transactions_status_index" on "wager_transactions" ("status");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_provider_id_external_transaction_id_unique" unique ("provider_id", "external_transaction_id");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);

    this.addSql(`create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" "ledger_direction" not null, "money_amount" numeric(20,2) not null, "currency" text not null, "balance_before_amount" numeric(20,2) not null, "balance_after_amount" numeric(20,2) not null, "created_at" timestamptz not null, constraint "wallet_ledger_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "wallet_ledger_entries_wallet_id_index" on "wallet_ledger_entries" ("wallet_id");`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_id_wallet_id_unique" unique ("transaction_id", "wallet_id");`);

    this.addSql(`create table "wallets" ("id" uuid not null, "player_id" uuid not null, "currency" text not null, "balance_amount" numeric(20,2) not null, "version" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "wallets_pkey" primary key ("id"));`);
    this.addSql(`alter table "wallets" add constraint "wallets_player_id_currency_unique" unique ("player_id", "currency");`);

    // ---- Integridade financeira adicional (nível de schema) ----
    this.addSql(`alter table "wallets" add constraint "wallets_balance_non_negative" check ("balance_amount" >= 0);`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_money_non_negative" check ("money_amount" >= 0);`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "ledger_money_non_negative" check ("money_amount" >= 0);`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "ledger_balances_non_negative" check ("balance_before_amount" >= 0 and "balance_after_amount" >= 0);`);

    // ---- Foreign keys ----
    this.addSql(`alter table "wager_transactions" add constraint "fk_wager_tx_wallet" foreign key ("wallet_id") references "wallets" ("id");`);
    this.addSql(`alter table "wager_transactions" add constraint "fk_wager_tx_reference" foreign key ("reference_transaction_id") references "wager_transactions" ("id");`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "fk_ledger_wallet" foreign key ("wallet_id") references "wallets" ("id");`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "fk_ledger_transaction" foreign key ("transaction_id") references "wager_transactions" ("id");`);

    // ---- Ledger append-only: proibir UPDATE/DELETE ----
    this.addSql(`
      create or replace function prevent_ledger_modification() returns trigger as $$
      begin
        raise exception 'wallet_ledger_entries is append-only';
      end;
      $$ language plpgsql;
    `);
    this.addSql(`
      create trigger trg_ledger_no_update
      before update or delete on "wallet_ledger_entries"
      for each row execute function prevent_ledger_modification();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger if exists "trg_ledger_no_update" on "wallet_ledger_entries" cascade;`);
    this.addSql(`drop function if exists prevent_ledger_modification() cascade;`);

    this.addSql(`drop table if exists "inbox_messages" cascade;`);

    this.addSql(`drop table if exists "outbox_messages" cascade;`);

    this.addSql(`drop table if exists "wager_transactions" cascade;`);

    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);

    this.addSql(`drop table if exists "wallets" cascade;`);

    this.addSql(`drop type "wager_transaction_kind";`);
    this.addSql(`drop type "wager_transaction_status";`);
    this.addSql(`drop type "failure_code";`);
    this.addSql(`drop type "ledger_direction";`);
  }

}
