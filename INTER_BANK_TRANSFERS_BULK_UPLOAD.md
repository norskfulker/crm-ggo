# Inter Bank Transfers Bulk Upload Feature

## Overview

The Inter Bank Transfers module now includes a sophisticated bulk upload feature that provides an Excel-like interface for reviewing and editing CSV data before submission. This feature is similar to the existing bulk upload functionality in the Payouts module.

## Features

### 1. CSV File Upload
- Upload CSV files with interbank transfer data
- Supports multiple column name formats (e.g., "From Bank", "from_bank")
- Automatic file validation and parsing

### 2. Excel-like Editor Interface
- **Interactive Table**: Edit data directly in the table cells
- **Real-time Validation**: Immediate feedback on data errors
- **Row Approval System**: Check/uncheck rows for approval
- **Add/Remove Rows**: Dynamically add new rows or remove existing ones
- **Bulk Actions**: Approve all valid rows at once

### 3. Data Validation
- **Required Fields**: From Bank, To Bank, Amount, Date
- **Date Format**: DD/MM/YYYY format validation
- **Amount Validation**: Numeric validation with positive values
- **UTR Validation**: Minimum 3 characters, duplicate checking
- **Live UTR Checking**: Real-time validation against existing database records

### 4. Duplicate UTR Handling
- **Database Duplicates**: Identifies UTRs already in the system
- **CSV Duplicates**: Detects duplicate UTRs within the uploaded file
- **Conflict Resolution**: Option to delete existing database entries
- **Detailed Information**: Shows existing transfer details for conflicts

### 5. Export Functionality
- **Export Valid Data**: Download corrected CSV with only valid rows
- **Sample CSV**: Download template file for reference

## CSV Format

### Required Columns
- **From Bank**: Source bank name
- **To Bank**: Destination bank name  
- **Amount**: Transfer amount in INR
- **Date**: Transfer date in DD/MM/YYYY format

### Optional Columns
- **UTR**: Unique Transaction Reference (minimum 3 characters)
- **Notes**: Additional notes or comments

### Example CSV
```csv
From Bank,To Bank,Amount,Date,UTR,Notes
HDFC Bank,SBI Bank,50000,15/12/2023,UTR123456,Transfer for business
ICICI Bank,Axis Bank,25000,16/12/2023,UTR789012,Monthly transfer
```

## Usage Instructions

### 1. Access Bulk Upload
1. Navigate to the Inter Bank Transfers page
2. Click the "CSV Bulk Upload" button in the top right

### 2. Upload CSV File
1. Click "Choose File" to select your CSV file
2. The file will be automatically parsed and validated
3. Click "Download Sample CSV" to get a template if needed

### 3. Review and Edit Data
1. The Excel-like editor will display your data
2. **Green rows**: Valid data (ready for approval)
3. **Red rows**: Data with errors (must be fixed before approval)
4. Edit any cells directly by clicking on them
5. Use "Add Row" to add new entries
6. Use "Remove" to delete unwanted rows

### 4. Handle Duplicate UTRs
1. If duplicate UTRs are found, a warning section will appear
2. Review the existing transfers with conflicting UTRs
3. Click "Delete Database UTR(s)" to remove existing entries
4. This will allow you to proceed with the upload

### 5. Approve and Submit
1. Check the approval box for rows you want to import
2. Use "Approve All Valid" to approve all error-free rows
3. Review the summary showing approved/error counts
4. Click "Save X Approved Transfer(s)" to import the data

## Validation Rules

### From Bank & To Bank
- **Required**: Cannot be empty
- **Format**: Any text string

### Amount
- **Required**: Cannot be empty
- **Format**: Numeric value greater than 0
- **Display**: Automatically formatted with Indian Rupee symbol

### Date
- **Required**: Cannot be empty
- **Format**: DD/MM/YYYY (e.g., 15/12/2023)
- **Range**: Years 2022-2025
- **Auto-formatting**: Automatically adds slashes as you type

### UTR
- **Optional**: Can be empty
- **Minimum Length**: 3 characters if provided
- **Duplicate Check**: Validated against existing database records
- **Live Validation**: Real-time checking as you type

### Notes
- **Optional**: Can be empty
- **Format**: Any text string

## Error Handling

### Common Errors
- **Missing Required Fields**: From Bank, To Bank, Amount, or Date
- **Invalid Date Format**: Must be DD/MM/YYYY
- **Invalid Amount**: Must be a positive number
- **Short UTR**: Must be at least 3 characters
- **Duplicate UTR**: Already exists in database or CSV

### Error Display
- **Red Background**: Rows with errors
- **Error Messages**: Specific error details below each field
- **Validation Status**: Clear indicators for valid/invalid rows

## Technical Details

### File Processing
- Uses Papa Parse library for CSV parsing
- Supports multiple column name formats
- Handles empty lines and malformed data gracefully

### Database Integration
- Real-time validation against existing records
- Batch insertion for approved rows
- Transaction safety with error rollback

### Performance
- Efficient handling of large CSV files
- Lazy loading of validation results
- Optimized database queries

## Troubleshooting

### Common Issues
1. **File Not Uploading**: Ensure file is CSV format
2. **Date Errors**: Check DD/MM/YYYY format
3. **Amount Errors**: Ensure positive numeric values
4. **UTR Conflicts**: Review existing transfers or delete duplicates

### Support
- Use the sample CSV template for correct formatting
- Check validation messages for specific error details
- Contact support if technical issues persist

## Future Enhancements

- **Bank Name Autocomplete**: Suggest existing bank names
- **Batch Size Limits**: Configurable upload limits
- **Advanced Validation**: Custom validation rules
- **Import History**: Track previous bulk uploads
- **Scheduled Imports**: Automated CSV processing
