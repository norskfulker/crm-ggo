# CSV Upload Guide for Payments & Payouts

This guide explains how to use the bulk CSV upload functionality for Payments and Payouts in the GGO Ledger CRM.

## Features

### 1. Bulk CSV Upload
- **Location**: Available in both Payments and Payouts sections
- **Button**: "Upload CSV" button in the header
- **Sample Download**: Download sample CSV files to understand the format
- **Automatic Duplicate Detection**: Based on UTR numbers
- **Validation**: Customer email validation and data format checking

 ### 2. Duplicate Handling
 - **UTR-based Detection**: Automatically detects and skips duplicate UTRs
 - **Original Preservation**: Keeps existing records, skips new duplicates
 - **Detailed Reporting**: Shows which UTRs were skipped due to duplicates

 ### 3. Missing Entries Correction
 - **Excel-style Table**: Invalid entries are displayed in an editable table
 - **Easy Fixing**: Users can correct customer emails, amounts, dates, and other fields
 - **Batch Save**: Fix multiple entries at once and save them together
 - **Error Highlighting**: Clear indication of what caused each entry to fail

## CSV Format Requirements

### Required Columns
1. **Customer Email** (Required)
   - Must be a valid email address
   - Customer must exist in the system
   - Case-insensitive matching

2. **Amount (INR)** (Required)
   - Must be a positive number
   - Can include commas and currency symbols (will be stripped)
   - Examples: "10000", "₹10,000", "10,000.50"

 3. **Date** (Required)
    - Format: DD/MM/YYYY
    - Examples: "01/01/2024", "15/12/2023"
    - Alternative formats: DD-MMM-YY (e.g., "30-Aug-22")
    - All date inputs in the system use DD/MM/YYYY format

### Optional Columns
4. **UTR** (Optional)
   - Unique Transaction Reference number
   - Must be unique if provided
   - Duplicates will be automatically skipped
   - Examples: "UTR123456789", "IMPS123456"

5. **Notes** (Optional)
   - Additional information about the transaction
   - Free text field

## Sample CSV Format

 ```csv
 Customer Email,Amount (INR),Date,UTR,Notes
 john.doe@example.com,10000,01/01/2024,UTR123456789,Sample payment
 jane.smith@example.com,15000,15/12/2023,UTR987654321,Another payment
 bob.johnson@example.com,20000,30-Aug-22,UTR456789123,Third payment
 ```

## How to Use

### 1. Prepare Your CSV File
1. Create a CSV file with the required headers
2. Add your transaction data
3. Ensure customer emails exist in the system
4. Use unique UTRs (if provided)

### 2. Upload Process
1. Click the "Upload CSV" button in Payments or Payouts section
2. Click "Download Sample CSV" to get a template
3. Select your CSV file
4. The system will automatically:
   - Validate the file format
   - Check for required columns
   - Validate customer emails
   - Check for duplicate UTRs
   - Parse dates and amounts
   - Import valid records

 ### 3. Results
 After upload, you'll see a detailed message showing:
 - Number of successfully imported records
 - Number of duplicate UTRs skipped
 - Number of invalid entries (with reasons)
 - Examples of skipped entries

 ### 4. Missing Entries Table
 If there are invalid entries, a special table will appear:
 - **Yellow Warning Border**: Clearly indicates entries that need attention
 - **Editable Fields**: All fields can be corrected directly in the table
 - **Error Column**: Shows the specific reason each entry failed
 - **Remove Option**: Delete entries you don't want to fix
 - **Batch Save**: Save all corrected entries at once

## Validation Rules

### Customer Email Validation
- Email must exist in the customers table
- Case-insensitive matching
- Invalid emails will be skipped with error details

### Amount Validation
- Must be a positive number
- Supports various formats (commas, currency symbols)
- Invalid amounts will be skipped

 ### Date Validation
 - Primary format: DD/MM/YYYY
 - Also supports: DD-MMM-YY (e.g., "30-Aug-22")
 - Invalid dates will be skipped

### UTR Validation
- Must be unique if provided
- Case-insensitive duplicate detection
- Existing UTRs will be skipped

## Error Handling

### Common Errors
1. **Missing Required Columns**: CSV must have "Customer Email", "Amount (INR)", "Date"
2. **Invalid Customer Email**: Email doesn't exist in the system
3. **Invalid Amount**: Not a positive number
4. **Invalid Date**: Cannot parse the date format
5. **Duplicate UTR**: UTR already exists in the system

### Error Messages
The system provides detailed error messages showing:
- Which entries were skipped
- Reasons for skipping
- Examples of problematic data

## Best Practices

### 1. Data Preparation
- Use the sample CSV as a template
- Verify all customer emails exist before uploading
- Use unique UTRs for each transaction
- Test with a small file first

### 2. File Format
- Use UTF-8 encoding
- Include headers in the first row
- Use commas as separators
- Avoid special characters in data

### 3. Validation
- Check customer emails are correct
- Ensure amounts are positive numbers
- Use consistent date format
- Verify UTRs are unique

## Troubleshooting

### Upload Fails
- Check file format (must be .csv)
- Verify required columns are present
- Ensure customer emails exist in the system

 ### Some Records Skipped
 - Check error message for specific reasons
 - Verify customer emails are correct
 - Check for duplicate UTRs
 - Validate date and amount formats
 - **Use the Missing Entries Table**: If available, fix entries directly in the table

### No Records Imported
- All records may have validation errors
- Check the detailed error message
- Verify CSV format matches requirements

## Technical Notes

- **File Size**: No specific limit, but large files may take longer to process
- **Encoding**: UTF-8 recommended
- **Performance**: Processing happens in batches for efficiency
- **Rollback**: No automatic rollback - check results before proceeding
- **Logging**: All import activities are logged for audit purposes

## Support

If you encounter issues:
1. Check the error messages for specific details
2. Verify your CSV format matches the sample
3. Ensure all customer emails exist in the system
4. Test with a smaller file first
