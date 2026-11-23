# GGO Ledger CRM

A simple web-based CRM application for tracking customers, payments (inflows), and payouts (outflows) with balance calculations.

## Features

- **Customer Management**: Add, edit, and delete customers with email addresses
- **Payment Tracking**: Record incoming payments from customers
- **Payout Tracking**: Record outgoing payments to customers
- **Balance View**: See individual customer balances (payments - payouts)
- **Dashboard**: Overview of total payments, payouts, and net balance
- **Data Export**: Export all data to CSV format
- **Simple Authentication**: Username/password login system
- **Responsive Design**: Clean, minimal interface

## Tech Stack

- **Frontend**: React.js with React Router
- **Backend**: Supabase (PostgreSQL database + authentication)
- **Styling**: Custom CSS with responsive design
- **Data Export**: PapaParse for CSV generation

## Setup Instructions

### 1. Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Supabase account

### 2. Supabase Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Go to your project dashboard
3. Navigate to SQL Editor and run the following SQL to create the database schema:

```sql
-- Create customers table
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create payments table
CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  amount_inr DECIMAL(10,2) NOT NULL,
  date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create payouts table
CREATE TABLE payouts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  amount_inr DECIMAL(10,2) NOT NULL,
  date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "Users can view all customers" ON customers FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert customers" ON customers FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update customers" ON customers FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete customers" ON customers FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can view all payments" ON payments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert payments" ON payments FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update payments" ON payments FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete payments" ON payments FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can view all payouts" ON payouts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert payouts" ON payouts FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update payouts" ON payouts FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete payouts" ON payouts FOR DELETE USING (auth.role() = 'authenticated');
```

4. Go to Settings > API to get your project URL and anon key

### 3. Environment Configuration

1. Copy `env.example` to `.env.local`:
```bash
cp env.example .env.local
```

2. Update `.env.local` with your Supabase credentials:
```
REACT_APP_SUPABASE_URL=your_actual_supabase_url
REACT_APP_SUPABASE_ANON_KEY=your_actual_supabase_anon_key
```

### 4. Install Dependencies

```bash
npm install
```

### 5. Start Development Server

```bash
npm start
```

The application will open at `http://localhost:3000`

### 6. Create User Account

1. Go to Supabase Dashboard > Authentication > Users
2. Click "Add User" and create your first user account
3. Use these credentials to log into the application

## Database Schema

### Customers Table
- `id` (UUID, Primary Key)
- `email` (TEXT, Required, Unique)
- `created_at` (TIMESTAMP)

### Payments Table
- `id` (UUID, Primary Key)
- `customer_id` (UUID, Foreign Key to customers)
- `amount_inr` (DECIMAL, Required)
- `date` (DATE, Required)
- `notes` (TEXT, Optional)
- `created_at` (TIMESTAMP)

### Payouts Table
- `id` (UUID, Primary Key)
- `customer_id` (UUID, Foreign Key to customers)
- `amount_inr` (DECIMAL, Required)
- `date` (DATE, Required)
- `notes` (TEXT, Optional)
- `created_at` (TIMESTAMP)

## Usage

### Dashboard
- View overall statistics including total payments, payouts, and net balance
- See recent payments and payouts

### Customers
- Add new customers with email address
- Edit existing customer email
- Delete customers (will also delete related payments/payouts)
- Export customer list to CSV
- Upload customers from CSV file

### Payments
- Record incoming payments from customers
- Select customer from dropdown
- Enter amount in INR
- Add date and optional notes
- Export payment history to CSV

### Payouts
- Record outgoing payments to customers
- Select customer from dropdown
- Enter amount in INR
- Add date and optional notes
- Export payout history to CSV

### Balances
- View individual customer balances
- See total payments vs total payouts for each customer
- Export balance report to CSV

## Security

- Row Level Security (RLS) enabled on all tables
- Only authenticated users can access data
- Foreign key constraints ensure data integrity
- Cascade deletes remove related records when customers are deleted

## Deployment

### Build for Production

```bash
npm run build
```

### Deploy to Vercel/Netlify

1. Push your code to GitHub
2. Connect your repository to Vercel or Netlify
3. Set environment variables in your deployment platform
4. Deploy

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is open source and available under the MIT License.

## Bank Search (statement lookup for payouts)

Accounting aid: search the bank statements by name, UTR, account number or amount while adding payouts.

1. Run `add-bank-transactions.sql` in the Supabase SQL Editor (once).
2. Open **Bank Statements** in the app and import `bank-data/bank_transactions.csv`.
   Re-importing is safe; rows already present are skipped.
3. In **Payouts → Add Multiple Payouts**, the Bank Search box follows the row you are editing:
   the customer's email becomes a name search (`rajesh.kumar@x.com` → `rajesh kumar`), and matches pop up
   instantly. **+ Add** fills the row's date, amount and UTR. PayUnie transfers are grossed up (÷ 0.89) and ticked Payunie.
   - Fuzzy matching handles typos and names cut short by the bank (`rajeshwari` finds `RAJESHWA`).
   - Duplicate checks: **Recorded** = UTR already in payouts/payments (PayUnie: same account + amount + date),
     **In this form** = already entered above, **Also in …** = the same UTR in another statement.

To add new statements, convert each PDF with `pdftotext -raw` (poppler), then run
`python -I scripts/parse_bank_statements.py bank-data idfc_sri=<txt> idfc_gg=<txt> icici_sri=<txt> payunie=<txt>`.
The script checks every row against the running balance and prints any mismatches.
`bank-data/` is git-ignored because it holds account data.
