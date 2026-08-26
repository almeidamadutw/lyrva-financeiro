CREATE TABLE `financial_obligations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`patient_id` integer NOT NULL,
	`clinicorp_payment_id` text,
	`competence` text NOT NULL,
	`cycle_start` text,
	`cycle_end` text,
	`expected_amount_cents` integer DEFAULT 0 NOT NULL,
	`paid_amount_cents` integer DEFAULT 0 NOT NULL,
	`due_date` text,
	`paid_at` text,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`invoice_status` text DEFAULT 'forecast' NOT NULL,
	`invoice_number` text,
	`invoice_issued_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `obligations_clinicorp_payment_unique` ON `financial_obligations` (`clinicorp_payment_id`);--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`imported_rows` integer DEFAULT 0 NOT NULL,
	`error_rows` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `message_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`obligation_id` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`external_message_id` text,
	`scheduled_for` text,
	`sent_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`obligation_id`) REFERENCES `financial_obligations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_events_once_unique` ON `message_events` (`obligation_id`,`kind`);--> statement-breakpoint
CREATE TABLE `patients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`clinicorp_id` text,
	`name` text NOT NULL,
	`cpf` text,
	`phone` text,
	`email` text,
	`unit` text NOT NULL,
	`treatment` text,
	`payment_method` text,
	`plan_amount_cents` integer DEFAULT 0 NOT NULL,
	`start_date` text,
	`installments` integer,
	`due_day` integer,
	`tax_receipt_ir` integer DEFAULT false NOT NULL,
	`invoice_frequency` text DEFAULT 'monthly' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patients_cpf_unique` ON `patients` (`cpf`);--> statement-breakpoint
CREATE UNIQUE INDEX `patients_clinicorp_id_unique` ON `patients` (`clinicorp_id`);