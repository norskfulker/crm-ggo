import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { format } from 'date-fns';
import Papa from 'papaparse';

function BulkUploadEditor({ 
  type, // 'payments' or 'payouts'
  csvData, 
  onSave, 
  onCancel, 
  customers 
}) {
  const [tableData, setTableData] = useState([]);
  const [validationErrors, setValidationErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [customerSearches, setCustomerSearches] = useState({});
  const [customerDropdowns, setCustomerDropdowns] = useState({});
  const [utrValidation, setUtrValidation] = useState({});

  useEffect(() => {
    if (csvData && csvData.length > 0) {
      processCSVData();
    }
  }, [csvData]);

  const processCSVData = () => {
    const processedData = csvData.map((row, index) => {
      const errors = {};
      
      // Check for missing required fields
      if (!row['Customer Email'] || row['Customer Email'].toString().trim() === '') {
        errors.customerEmail = 'Customer email is required';
      } else {
        // Check if customer exists
        const customerEmail = row['Customer Email'].toString().trim().toLowerCase();
        const customer = customers.find(c => c.email.toLowerCase() === customerEmail);
        if (!customer) {
          // If this is a newly created customer, don't show an error
          if (row.isNewCustomer && row.newlyCreatedCustomer) {
            // Customer was automatically created, so this is valid
          } else {
            errors.customerEmail = 'Customer not found in system';
          }
        }
      }

      if (!row['Amount (INR)'] || row['Amount (INR)'].toString().trim() === '') {
        errors.amount = 'Amount is required';
      } else {
        const amount = parseFloat(row['Amount (INR)'].toString().replace(/[^\d.-]/g, ''));
        if (isNaN(amount) || amount <= 0) {
          errors.amount = 'Invalid amount';
        }
      }

      // Auto-fix date format before validation
      let dateValue = row['Date']?.toString().trim() || '';
      if (dateValue) {
        dateValue = autoFixDateFormat(dateValue);
      }

      if (!dateValue) {
        errors.date = 'Date is required';
      } else {
        if (!validateDate(dateValue)) {
          errors.date = 'Invalid date format';
        }
      }

      // Check UTR if provided
      if (row['UTR'] && row['UTR'].toString().trim() !== '') {
        const utr = row['UTR'].toString().trim();
        if (utr.length < 3) {
          errors.utr = 'UTR must be at least 3 characters';
        }
        // Check for duplicate UTR error from the parent component
        if (row.duplicateUtrError) {
          errors.utr = row.duplicateUtrError;
        }
      }

      return {
        id: index,
        customerEmail: row['Customer Email']?.toString().trim() || '',
        amount: row['Amount (INR)']?.toString().trim() || '',
        date: dateValue,
        utr: row['UTR']?.toString().trim() || '',
        notes: row['Notes']?.toString().trim() || '',
        errors,
        originalRow: row,
        isNewCustomer: row.isNewCustomer || false,
        newlyCreatedCustomer: row.newlyCreatedCustomer || null
      };
    });

    // Sort data to show newly created customers at the top
    const sortedData = processedData.sort((a, b) => {
      if (a.isNewCustomer && !b.isNewCustomer) return -1;
      if (!a.isNewCustomer && b.isNewCustomer) return 1;
      return 0;
    });

    setTableData(sortedData);
    
    // Initialize customer searches
    const searches = {};
    sortedData.forEach(row => {
      if (row.customerEmail) {
        searches[row.id] = row.customerEmail;
      }
    });
    setCustomerSearches(searches);
  };

  const autoFixDateFormat = (dateString) => {
    if (!dateString || dateString.trim() === '') return dateString;
    
    const trimmedDate = dateString.trim();
    
    // Handle DD-MMM-YY format (e.g., "30-Aug-22")
    const ddMmmYyRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
    const ddMmmYyMatch = trimmedDate.match(ddMmmYyRegex);
    
    if (ddMmmYyMatch) {
      const [, day, month, year] = ddMmmYyMatch;
      const monthNames = {
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
        'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
      };
      
      const monthNum = monthNames[month.toLowerCase()];
      if (monthNum) {
        const fullYear = `20${year}`;
        const paddedDay = day.padStart(2, '0');
        return `${paddedDay}/${monthNum}/${fullYear}`;
      }
    }
    
    // Handle YYYY-MM-DD format (e.g., "2023-12-04")
    const ymdRegex = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
    const ymdMatch = trimmedDate.match(ymdRegex);
    
    if (ymdMatch) {
      const [, year, month, day] = ymdMatch;
      const paddedDay = day.padStart(2, '0');
      const paddedMonth = month.padStart(2, '0');
      return `${paddedDay}/${paddedMonth}/${year}`;
    }
    
    // Handle M/D/YYYY or D/M/YYYY format (e.g., "12/4/2023", "9/1/2023")
    // We'll assume it's M/D/YYYY format as that's more common in US/Excel
    const mdyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const mdyMatch = trimmedDate.match(mdyRegex);
    
    if (mdyMatch) {
      const [, first, second, year] = mdyMatch;
      const firstNum = parseInt(first);
      const secondNum = parseInt(second);
      
      // If first number is > 12, it's likely a day (D/M/YYYY)
      // If second number is > 12, it's likely M/D/YYYY
      // Default to M/D/YYYY format
      let month, day;
      
      if (firstNum > 12 && secondNum <= 12) {
        // D/M/YYYY format
        day = first;
        month = second;
      } else {
        // M/D/YYYY format (default)
        month = first;
        day = second;
      }
      
      const paddedDay = day.padStart(2, '0');
      const paddedMonth = month.padStart(2, '0');
      return `${paddedDay}/${paddedMonth}/${year}`;
    }
    
    // If it's already in DD/MM/YYYY format, just ensure proper padding
    const ddmmRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    const ddmmMatch = trimmedDate.match(ddmmRegex);
    
    if (ddmmMatch) {
      const [, day, month, year] = ddmmMatch;
      const paddedDay = day.padStart(2, '0');
      const paddedMonth = month.padStart(2, '0');
      return `${paddedDay}/${paddedMonth}/${year}`;
    }
    
    // Return original if no pattern matches
    return trimmedDate;
  };

  const validateDate = (dateString) => {
    if (!dateString || dateString.trim() === '') return false;
    
    // Handle DD-MMM-YY format (e.g., "30-Aug-22")
    const ddMmmYyRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
    const ddMmmYyMatch = dateString.match(ddMmmYyRegex);
    
    if (ddMmmYyMatch) {
      const [, day, month, year] = ddMmmYyMatch;
      const monthNames = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3,
        'may': 4, 'jun': 5, 'jul': 6, 'aug': 7,
        'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
      };
      
      const monthNum = monthNames[month.toLowerCase()];
      if (monthNum === undefined) return false;
      
      const fullYear = 2000 + parseInt(year);
      const date = new Date(fullYear, monthNum, parseInt(day));
      
      return date.getFullYear() === fullYear && 
             date.getMonth() === monthNum && 
             date.getDate() === parseInt(day) &&
             fullYear >= 2022 && fullYear <= 2025;
    }
    
    // Check if it matches DD/MM/YYYY format
    const dateRegex = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(202[2-5])$/;
    if (!dateRegex.test(dateString)) return false;
    
    // Additional validation for valid dates
    const [day, month, year] = dateString.split('/').map(Number);
    const date = new Date(year, month - 1, day);
    
    return date.getFullYear() === year && 
           date.getMonth() === month - 1 && 
           date.getDate() === day;
  };

  const updateRow = (rowId, field, value) => {
    const newData = [...tableData];
    const rowIndex = newData.findIndex(row => row.id === rowId);
    
    if (rowIndex === -1) return;

    const row = { ...newData[rowIndex] };
    
    // Special handling for date field
    if (field === 'date') {
      value = autoFixDateFormat(value);
    }

    // Update the field
    row[field] = value;
    
    // Clear previous errors for this field
    if (row.errors) {
      row.errors[field] = null;
    }

    // Validate the updated field
    const errors = { ...row.errors };
    
    if (field === 'customerEmail') {
      if (!value || value.trim() === '') {
        errors.customerEmail = 'Customer email is required';
      } else {
        const customerEmail = value.trim().toLowerCase();
        const customer = customers.find(c => c.email.toLowerCase() === customerEmail);
        if (!customer) {
          errors.customerEmail = 'Customer not found in system';
        }
      }
    }

    if (field === 'amount') {
      if (!value || value.trim() === '') {
        errors.amount = 'Amount is required';
      } else {
        const amount = parseFloat(value.toString().replace(/[^\d.-]/g, ''));
        if (isNaN(amount) || amount <= 0) {
          errors.amount = 'Invalid amount';
        }
      }
    }

    if (field === 'date') {
      if (!value || value.trim() === '') {
        errors.date = 'Date is required';
      } else {
        if (!validateDate(value.trim())) {
          errors.date = 'Invalid date format';
        }
      }
    }

    if (field === 'utr') {
      if (value && value.trim() !== '' && value.trim().length < 3) {
        errors.utr = 'UTR must be at least 3 characters';
      }
      // Clear any existing duplicate UTR error when user edits the field
      if (row.duplicateUtrError) {
        row.duplicateUtrError = null;
      }
    }

    row.errors = errors;
    newData[rowIndex] = row;
    setTableData(newData);

    // Update customer search state
    if (field === 'customerEmail') {
      setCustomerSearches(prev => ({
        ...prev,
        [rowId]: value
      }));
    }

    // Live UTR validation
    if (field === 'utr' && value.trim()) {
      validateUtrLive(value.trim(), rowId);
    } else if (field === 'utr' && !value.trim()) {
      setUtrValidation(prev => ({
        ...prev,
        [rowId]: { isValid: true, message: '' }
      }));
    }
  };

  const validateUtrLive = async (utr, rowId) => {
    try {
      // Check for duplicates in payments table
      const { data: existingPayments, error: paymentsCheckError } = await supabase
        .from('payments')
        .select('utr')
        .eq('utr', utr);

      if (paymentsCheckError) throw paymentsCheckError;

      // Check for duplicates in payouts table (using notes field as UTR)
      const { data: existingPayouts, error: payoutsCheckError } = await supabase
        .from('payouts')
        .select('notes')
        .eq('notes', utr);

      if (payoutsCheckError) throw payoutsCheckError;

      const isDuplicate = (existingPayments && existingPayments.length > 0) || 
                         (existingPayouts && existingPayouts.length > 0);

      setUtrValidation(prev => ({
        ...prev,
        [rowId]: {
          isValid: !isDuplicate,
          message: isDuplicate ? 'UTR already exists in the system' : 'UTR is available'
        }
      }));
    } catch (error) {
      console.error('Error validating UTR:', error);
      setUtrValidation(prev => ({
        ...prev,
        [rowId]: {
          isValid: false,
          message: 'Error checking UTR availability'
        }
      }));
    }
  };

  const handleCustomerSelect = (customer, rowId) => {
    updateRow(rowId, 'customerEmail', customer.email);
    setCustomerDropdowns(prev => ({
      ...prev,
      [rowId]: false
    }));
  };

  const getFilteredCustomers = (searchTerm) => {
    return customers.filter(customer =>
      customer.email.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  const addRow = () => {
    const newId = Math.max(...tableData.map(row => row.id), -1) + 1;
    const newRow = {
      id: newId,
      customerEmail: '',
      amount: '',
      date: format(new Date(), 'dd/MM/yyyy'),
      utr: '',
      notes: '',
      errors: {},
      originalRow: {}
    };
    setTableData([...tableData, newRow]);
  };

  const removeRow = (rowId) => {
    setTableData(tableData.filter(row => row.id !== rowId));
  };

  const hasErrors = (row) => {
    const hasValidationErrors = row.errors && Object.values(row.errors).some(error => error !== null);
    const hasDuplicateUtrError = row.duplicateUtrError;
    return hasValidationErrors || hasDuplicateUtrError;
  };

  const getValidRows = () => {
    return tableData.filter(row => {
      return row.customerEmail && 
             row.amount && 
             row.date && 
             !hasErrors(row) &&
             !row.duplicateUtrError; // Exclude rows with duplicate UTR errors
    });
  };

  const handleSave = async () => {
    const validRows = getValidRows();
    
    if (validRows.length === 0) {
      setMessage('Please fix all errors before saving');
      return;
    }

    setLoading(true);
    try {
      // Get customer IDs for all emails
      const customerEmails = [...new Set(validRows.map(row => row.customerEmail))];
      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select('id, email')
        .in('email', customerEmails);

      if (customerError) throw customerError;

      const customerMap = {};
      customerData.forEach(customer => {
        customerMap[customer.email] = customer.id;
      });

      // Prepare data for insertion
      const dataToInsert = validRows.map(row => {
        // Convert date to YYYY-MM-DD format for database
        let dbDate = row.date;
        
        // Handle DD-MMM-YY format (e.g., "30-Aug-22")
        const ddMmmYyRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
        const ddMmmYyMatch = row.date.match(ddMmmYyRegex);
        
        if (ddMmmYyMatch) {
          const [, day, month, year] = ddMmmYyMatch;
          const monthNames = {
            'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
            'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
            'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
          };
          
          const monthNum = monthNames[month.toLowerCase()];
          if (monthNum) {
            const fullYear = `20${year}`;
            const paddedDay = day.padStart(2, '0');
            dbDate = `${fullYear}-${monthNum}-${paddedDay}`;
          }
        } else if (row.date.includes('/')) {
          // Handle DD/MM/YYYY format
          const [day, month, year] = row.date.split('/');
          dbDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }

        const baseData = {
          customer_id: customerMap[row.customerEmail],
          amount_inr: parseFloat(row.amount.toString().replace(/[^\d.-]/g, '')),
          date: dbDate,
          notes: row.notes
        };

        if (type === 'payments') {
          return {
            ...baseData,
            utr: row.utr || null
          };
        } else {
          // For payouts, UTR goes in notes field
          return {
            ...baseData,
            notes: row.utr || row.notes
          };
        }
      });

      // Insert data
      const tableName = type === 'payments' ? 'payments' : 'payouts';
      const { error } = await supabase
        .from(tableName)
        .insert(dataToInsert);

      if (error) throw error;

      setMessage(`Successfully imported ${validRows.length} ${type}`);
      onSave && onSave(validRows.length);
    } catch (error) {
      console.error(`Error importing ${type}:`, error);
      setMessage(`Error importing ${type}. Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    const validRows = getValidRows();
    if (validRows.length === 0) {
      setMessage('No valid data to export');
      return;
    }

    const csvData = validRows.map(row => ({
      'Customer Email': row.customerEmail,
      'Amount (INR)': row.amount,
      'Date': row.date,
      'UTR': row.utr,
      'Notes': row.notes
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `corrected_${type}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRemoveAllErrors = () => {
    // Remove all rows that have errors
    const rowsWithErrors = tableData.filter(row => hasErrors(row));
    const validRows = tableData.filter(row => !hasErrors(row));
    
    setTableData(validRows);
    setMessage(`Removed ${rowsWithErrors.length} rows with errors. ${validRows.length} valid rows remaining.`);
  };

  return (
    <div className="bulk-upload-editor">
      <div className="editor-header">
        <div>
          <h3>Bulk Upload Editor - {type.charAt(0).toUpperCase() + type.slice(1)}</h3>
          {tableData.some(row => row.isNewCustomer) && (
            <div style={{ 
              marginTop: '0.5rem', 
              padding: '0.5rem', 
              backgroundColor: '#e8f5e8', 
              border: '1px solid #28a745', 
              borderRadius: '4px',
              fontSize: '0.9rem',
              color: '#155724'
            }}>
              <strong>ℹ️ New Customers Created:</strong> Some customers were automatically created and are highlighted with a green border and "NEW" badge. You can edit their details if needed.
            </div>
          )}
          {tableData.some(row => row.duplicateUtrError) && (
            <div style={{ 
              marginTop: '0.5rem', 
              padding: '0.5rem', 
              backgroundColor: '#f8d7da', 
              border: '1px solid #f5c6cb', 
              borderRadius: '4px',
              fontSize: '0.9rem',
              color: '#721c24'
            }}>
              <strong>⚠️ Duplicate UTRs Detected:</strong> Some entries have UTRs that already exist in the system. These entries are highlighted with a red border and will not be saved. Please change the UTRs or remove these entries.
            </div>
          )}
        </div>
        <div className="header-actions">
          <button 
            onClick={addRow} 
            className="btn btn-secondary"
            disabled={loading}
          >
            Add Row
          </button>
          <button 
            onClick={exportToCSV} 
            className="btn btn-secondary"
            disabled={loading || getValidRows().length === 0}
          >
            Export Valid Data
          </button>
        </div>
      </div>

      {message && (
        <div className={`message ${message.includes('Error') ? 'error' : 'success'}`}>
          {message}
        </div>
      )}

      <div className="table-container">
        <table className="excel-table">
          <thead>
            <tr>
              <th>Row</th>
              <th>Customer Email *</th>
              <th>Amount (INR) *</th>
              <th>Date *</th>
              <th>UTR</th>
              <th>Notes</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tableData.map((row, index) => (
              <tr key={row.id} className={`${hasErrors(row) ? 'has-errors' : 'valid-row'} ${row.isNewCustomer ? 'new-customer-row' : ''}`}
                  style={row.duplicateUtrError ? { backgroundColor: '#fff5f5', borderLeft: '4px solid #dc3545' } : {}}>
                <td>
                  {index + 1}
                  {row.isNewCustomer && (
                    <span style={{ 
                      marginLeft: '5px', 
                      backgroundColor: '#28a745', 
                      color: 'white', 
                      padding: '2px 6px', 
                      borderRadius: '3px', 
                      fontSize: '0.7rem',
                      fontWeight: 'bold'
                    }} title="Newly created customer">
                      NEW
                    </span>
                  )}
                </td>
                
                {/* Customer Email */}
                <td className="customer-email-cell">
                  <div className="input-container">
                    <input
                      type="text"
                      value={customerSearches[row.id] || ''}
                      onChange={(e) => {
                        setCustomerSearches(prev => ({
                          ...prev,
                          [row.id]: e.target.value
                        }));
                        setCustomerDropdowns(prev => ({
                          ...prev,
                          [row.id]: true
                        }));
                      }}
                      onFocus={() => {
                        setCustomerDropdowns(prev => ({
                          ...prev,
                          [row.id]: true
                        }));
                      }}
                      className={row.errors?.customerEmail ? 'error' : ''}
                      placeholder="Enter customer email"
                    />
                    {customerDropdowns[row.id] && (
                      <div className="dropdown">
                        {getFilteredCustomers(customerSearches[row.id] || '').map(customer => (
                          <div
                            key={customer.id}
                            className="dropdown-item"
                            onClick={() => handleCustomerSelect(customer, row.id)}
                          >
                            {customer.email}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {row.errors?.customerEmail && (
                    <div className="error-message">{row.errors.customerEmail}</div>
                  )}
                </td>

                {/* Amount */}
                <td>
                  <input
                    type="text"
                    value={row.amount}
                    onChange={(e) => updateRow(row.id, 'amount', e.target.value)}
                    className={row.errors?.amount ? 'error' : ''}
                    placeholder="Enter amount"
                  />
                  {row.errors?.amount && (
                    <div className="error-message">{row.errors.amount}</div>
                  )}
                </td>

                {/* Date */}
                <td>
                  <input
                    type="text"
                    value={row.date}
                    onChange={(e) => updateRow(row.id, 'date', e.target.value)}
                    className={row.errors?.date ? 'error' : ''}
                    placeholder="DD/MM/YYYY"
                  />
                  {row.errors?.date && (
                    <div className="error-message">{row.errors.date}</div>
                  )}
                </td>

                {/* UTR */}
                <td>
                  <input
                    type="text"
                    value={row.utr}
                    onChange={(e) => updateRow(row.id, 'utr', e.target.value)}
                    className={row.errors?.utr || row.duplicateUtrError ? 'error' : ''}
                    placeholder="Enter UTR"
                    style={row.duplicateUtrError ? { borderColor: '#dc3545', backgroundColor: '#fff5f5' } : {}}
                  />
                  {utrValidation[row.id] && (
                    <div className={`validation-message ${utrValidation[row.id].isValid ? 'valid' : 'invalid'}`}>
                      {utrValidation[row.id].message}
                    </div>
                  )}
                  {row.errors?.utr && (
                    <div className="error-message">{row.errors.utr}</div>
                  )}
                  {row.duplicateUtrError && (
                    <div className="error-message" style={{ color: '#dc3545', fontWeight: 'bold' }}>
                      ⚠️ {row.duplicateUtrError}
                    </div>
                  )}
                </td>

                {/* Notes */}
                <td>
                  <input
                    type="text"
                    value={row.notes}
                    onChange={(e) => updateRow(row.id, 'notes', e.target.value)}
                    placeholder="Enter notes"
                  />
                </td>

                {/* Status */}
                <td>
                  <div className={`status ${hasErrors(row) ? 'error' : 'valid'}`}>
                    {hasErrors(row) ? '❌ Errors' : '✅ Valid'}
                  </div>
                </td>

                {/* Actions */}
                <td>
                  <button
                    onClick={() => removeRow(row.id)}
                    className="btn btn-danger btn-sm"
                    disabled={loading}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="editor-footer">
        <div className="summary">
          <p>Total Rows: {tableData.length}</p>
          <p>Valid Rows: {getValidRows().length}</p>
          <p>Rows with Errors: {tableData.filter(hasErrors).length}</p>
          {tableData.filter(row => row.duplicateUtrError).length > 0 && (
            <p style={{ color: '#dc3545', fontWeight: 'bold' }}>
              ⚠️ Duplicate UTRs: {tableData.filter(row => row.duplicateUtrError).length} rows have duplicate UTRs that already exist in the system
            </p>
          )}
        </div>
        <div className="actions">
          <button
            onClick={handleRemoveAllErrors}
            className="btn btn-warning"
            disabled={loading}
            style={{ marginRight: '0.5rem' }}
          >
            Remove Error Rows
          </button>
          <button
            onClick={onCancel}
            className="btn btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary"
            disabled={loading || getValidRows().length === 0}
            style={{ marginLeft: '0.5rem' }}
          >
            {loading ? 'Saving...' : `Save ${getValidRows().length} Valid ${type.charAt(0).toUpperCase() + type.slice(1)}`}
          </button>
        </div>
      </div>


    </div>
  );
}

export default BulkUploadEditor;
