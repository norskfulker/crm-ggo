# Inter Bank Transfers Setup Guide

This guide explains how to set up and use the new Inter Bank Transfers functionality in the GGO Ledger CRM.

## Overview

Inter Bank Transfers allow you to track money movements between different bank accounts. These transfers are **NOT included** in the total deposits and payouts calculations, making them perfect for internal fund movements.

## Setup Steps

### 1. Database Migration
Run the `add-inter-bank-transfers.sql` file in your Supabase SQL Editor to create the necessary table and default bank tags.

### 2. Database Structure
The migration creates:
- `inter_bank_transfers`: Stores transfer information with bank tags
- Default bank tags: HDFC Bank, SBI Bank, ICICI Bank, Axis Bank, Kotak Bank, Yes Bank, PNB Bank, Canara Bank

### 3. Bank Tags
- **Location**: Navigate to the "Tags" section in the main menu
- **Create Bank Tags**: Add new bank tags with custom names and colors
- **Edit Tags**: Modify existing bank tag names and colors
- **Delete Tags**: Remove tags (will also remove them from all transfers)

## Using Inter Bank Transfers

### Adding Transfers
1. Go to the "Inter Bank Transfers" section
2. Click "Add Transfer"
3. Fill in the required fields:
   - **Bank Tag**: Select the bank tag (e.g., HDFC Bank)
   - **From Bank**: Enter the source account (e.g., "HDFC Bank - Main Account")
   - **To Bank**: Enter the destination account (e.g., "SBI Bank - Savings Account")
   - **Amount (INR)**: Enter the transfer amount
   - **Date**: Enter the transfer date
   - **UTR**: Optional UTR number for tracking
   - **Notes**: Optional notes for the transfer

### Managing Transfers
- **List View**: View all inter bank transfers in a table format
- **Edit**: Modify existing transfers
- **Delete**: Remove transfers
- **Bank Tags**: Each transfer shows the associated bank tag with color coding

### Dashboard Integration
- **Total Amount**: Shows total inter bank transfer amount (separate from net balance)
- **Recent Transfers**: Displays the 5 most recent transfers
- **Visual Indicators**: Transfers are clearly marked as not included in net balance

## Key Features

### Bank Tag System
- **Visual Distinction**: Color-coded bank tags make it easy to identify different banks
- **Flexible**: Add new bank tags as needed
- **Organized**: Group transfers by bank for better tracking

### From/To Bank Fields
- **Detailed Tracking**: Specify exact account names for both source and destination
- **Clear Flow**: Easy to understand money movement direction
- **Flexible**: Support any account naming convention

### Exclusion from Net Balance
- **Separate Tracking**: Inter bank transfers don't affect customer payment/payout totals
- **Internal Movements**: Perfect for tracking internal fund movements
- **Clear Reporting**: Dashboard clearly shows these are separate from business transactions

## Best Practices

### Bank Tag Management
1. Create bank tags for all banks you use
2. Use consistent naming (e.g., "HDFC Bank", "SBI Bank")
3. Choose distinct colors for easy identification

### Account Naming
1. Use descriptive account names (e.g., "HDFC Bank - Main Account")
2. Be consistent with naming conventions
3. Include account types when relevant (Savings, Current, etc.)

### Transfer Documentation
1. Always include UTR numbers when available
2. Add notes for transfer purpose
3. Use consistent date formats

## Troubleshooting

### Common Issues
- **No Bank Tags Available**: Make sure you've created bank tags in the Tags section first
- **Tags Not Showing**: Refresh the page or check if the database migration was successful
- **Transfer Not Saving**: Ensure all required fields are filled

### Data Integrity
- **UTR Validation**: System checks for duplicate UTRs
- **Date Validation**: Supports DD/MM/YYYY format
- **Amount Validation**: Only positive amounts are allowed

## Integration with Existing Features

### Tags System
- Inter bank transfers use the existing tags system
- Bank-specific tags are automatically filtered
- Maintains consistency with customer tagging

### Dashboard
- Shows inter bank transfer totals separately
- Displays recent transfers for quick overview
- Clearly indicates exclusion from net balance

### Navigation
- New "Inter Bank Transfers" tab in main navigation
- Integrated seamlessly with existing menu structure
- Consistent UI/UX with other sections
