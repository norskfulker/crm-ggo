# Bulk Upload Editor Guide

## Overview
The Bulk Upload Editor is an Excel-like interface that allows users to review and correct CSV data before importing it into the system. It provides real-time validation, customer search functionality, and the ability to edit data before saving.

## Key Features

### 1. **Automatic Customer Creation**
- **New Feature**: If a customer email in the CSV is not found in the system, the system will automatically create a new customer record
- Newly created customers are highlighted with a green "NEW" badge and special styling
- Entries with newly created customers are automatically sorted to the top of the editor for easy review
- This eliminates the need to manually create customers before bulk uploading

### 2. **Real-time Validation**
- Validates customer email existence (or marks as newly created)
- Validates amount format (must be a positive number)
- Validates date format (supports DD/MM/YYYY and DD-MMM-YY formats)
- Validates UTR length (minimum 3 characters)
- Shows live UTR duplicate checking

### 3. **Excel-like Interface**
- Editable table format similar to Excel
- Add/remove rows dynamically
- Customer email autocomplete dropdown
- Visual error indicators
- Status column showing valid/invalid entries

### 4. **Customer Search & Autocomplete**
- Type customer email to see matching suggestions
- Dropdown shows all matching customers
- Click to select customer from dropdown
- Supports partial email matching

## How It Works

### 1. **CSV Upload Process**
1. User uploads a CSV file through the Payments or Payouts section
2. System processes the CSV and identifies:
   - Valid entries (ready for import)
   - Invalid entries (missing data, validation errors)
   - Duplicate UTRs (skipped automatically)
   - Missing customers (automatically created)

### 2. **Automatic Customer Creation**
- When a customer email is not found in the system:
  - System automatically creates a new customer record
  - The entry is marked as having a newly created customer
  - These entries are prioritized at the top of the bulk editor
  - User can review and edit these entries before final import

### 3. **Bulk Editor Display**
- Invalid entries are shown in the Excel-like interface
- Newly created customers are highlighted with green styling and "NEW" badge
- Users can edit any field directly in the table
- Real-time validation provides immediate feedback

### 4. **Save Process**
- Only valid entries are saved to the database
- Invalid entries remain in the editor for correction
- Success message shows count of imported entries and newly created customers

## CSV Format Requirements

### Required Columns:
- **Customer Email**: Valid email address (new customers will be created automatically)
- **Amount (INR)**: Positive number (e.g., 10000, 15000.50)
- **Date**: DD/MM/YYYY or DD-MMM-YY format (e.g., 01/01/2024, 30-Aug-22)

### Optional Columns:
- **UTR**: Unique transaction reference (minimum 3 characters)
- **Notes**: Additional information

### Example CSV:
```csv
Customer Email,Amount (INR),Date,UTR,Notes
john.doe@example.com,10000,01/01/2024,UTR123456789,Sample payment
newcustomer@test.com,15000,15/12/2023,UTR987654321,New customer
jane.smith@example.com,20000,30/12/2023,UTR456789123,Existing customer
```

## Error Types Handled

### 1. **Customer Email Errors**
- **Missing email**: "Customer email is required"
- **Customer not found**: "Customer not found in system" (unless auto-created)
- **New customers**: Automatically created and highlighted

### 2. **Amount Errors**
- **Missing amount**: "Amount is required"
- **Invalid amount**: "Invalid amount" (must be positive number)

### 3. **Date Errors**
- **Missing date**: "Date is required"
- **Invalid format**: "Invalid date format" (supports DD/MM/YYYY and DD-MMM-YY)

### 4. **UTR Errors**
- **Too short**: "UTR must be at least 3 characters"
- **Duplicate**: "UTR already exists" (live validation)

## Benefits

### 1. **Improved User Experience**
- No need to manually create customers before bulk upload
- Visual feedback for newly created customers
- Excel-like interface familiar to users
- Real-time validation prevents errors

### 2. **Data Quality**
- Automatic customer creation reduces data entry errors
- Validation ensures data integrity
- Duplicate UTR prevention
- Clear error messages guide corrections

### 3. **Efficiency**
- Bulk processing of multiple entries
- Automatic sorting of new customers to top
- Export functionality for valid data
- One-click save for all valid entries

## Technical Implementation

### 1. **Component Structure**
- `BulkUploadEditor.js`: Main component for the Excel-like interface
- Integrated into `Payments.js` and `Payouts.js` components
- Uses Supabase for database operations

### 2. **State Management**
- `tableData`: Editable rows with validation state
- `validationErrors`: Error messages for each field
- `customerSearches`: Customer search terms
- `customerDropdowns`: Dropdown visibility state

### 3. **Database Operations**
- Automatic customer creation via Supabase
- Batch payment/payout insertion
- UTR duplicate checking
- Transaction rollback on errors

### 4. **Styling**
- CSS classes for different row states
- Green highlighting for new customers
- Error styling for invalid fields
- Responsive table design

## Usage Instructions

### 1. **Upload CSV**
1. Go to Payments or Payouts section
2. Click "Bulk Upload" button
3. Select CSV file with required columns
4. System processes file and shows bulk editor if needed

### 2. **Review and Edit**
1. Check entries with "NEW" badge (newly created customers)
2. Review validation errors in red
3. Edit any fields directly in the table
4. Use customer dropdown for email selection

### 3. **Save Data**
1. Click "Save Valid Entries" button
2. System saves only valid entries
3. Invalid entries remain for correction
4. Success message shows import results

### 4. **Export (Optional)**
1. Click "Export Valid Data" to download corrected CSV
2. Useful for saving corrected data for future use

## Troubleshooting

### Common Issues:
1. **CSV format errors**: Ensure required columns are present
2. **Date format issues**: Use DD/MM/YYYY or DD-MMM-YY format
3. **Amount validation**: Ensure positive numbers only
4. **UTR duplicates**: Check for existing UTRs in system

### Support:
- Check error messages in the interface
- Review CSV format requirements
- Ensure all required fields are filled
- Contact support for technical issues
