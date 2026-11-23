import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { format } from 'date-fns';
import Papa from 'papaparse';

function InterBankTransfersBulkEditor({ 
  csvData, 
  onSave, 
  onCancel, 
  bankTags 
}) {
  const [tableData, setTableData] = useState([]);
  const [validationErrors, setValidationErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [utrValidation, setUtrValidation] = useState({});
  const [duplicateUtrs, setDuplicateUtrs] = useState([]);
  const [deletingUtrs, setDeletingUtrs] = useState(false);

  useEffect(() => {
    if (csvData && csvData.length > 0) {
      processCSVData();
    }
  }, [csvData]);

  const processCSVData = async () => {
    const processedData = [];
    
    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i];
      const errors = {};
      
      // Check for missing required fields
      if (!row.from_bank || row.from_bank.toString().trim() === '') {
        errors.fromBank = 'From Bank is required';
      }

      if (!row.to_bank || row.to_bank.toString().trim() === '') {
        errors.toBank = 'To Bank is required';
      }

      if (!row.amount_inr || row.amount_inr.toString().trim() === '') {
        errors.amount = 'Amount is required';
      } else {
        const amount = parseFloat(row.amount_inr.toString().replace(/[^\d.-]/g, ''));
        if (isNaN(amount) || amount <= 0) {
          errors.amount = 'Invalid amount';
        }
      }

             if (!row.date || row.date.toString().trim() === '') {
         errors.date = 'Date is required';
       } else {
         const convertedDate = convertDateFormat(row.date.toString().trim());
         if (!validateDate(convertedDate)) {
           errors.date = 'Invalid date format (DD/MM/YYYY or MM-DD-YYYY)';
         }
       }

      // Check UTR if provided
      if (row.utr && row.utr.toString().trim() !== '') {
        const utr = row.utr.toString().trim();
        if (utr.length < 3) {
          errors.utr = 'UTR must be at least 3 characters';
        }
      }

             processedData.push({
         id: i,
         fromBank: row.from_bank?.toString().trim() || '',
         toBank: row.to_bank?.toString().trim() || '',
         amount: row.amount_inr?.toString().trim() || '',
         date: convertDateFormat(row.date?.toString().trim() || ''),
         utr: row.utr?.toString().trim().replace(/,/g, '') || '', // Remove commas from UTR
         notes: row.notes?.toString().trim() || '',
         errors,
         originalRow: row,
         approved: false
       });
    }

    setTableData(processedData);
    
    // Check for duplicate UTRs
    await checkDuplicateUtrs(processedData);
  };

  const validateDate = (dateString) => {
    if (!dateString || dateString.trim() === '') return false;
    
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

  const convertDateFormat = (dateString) => {
    if (!dateString || dateString.trim() === '') return '';
    
    // Handle MM-DD-YYYY format (e.g., "27-Feb-23")
    const mmddyyyyRegex = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/;
    const match = dateString.match(mmddyyyyRegex);
    
    if (match) {
      const [, month, day, year] = match;
      const monthNames = {
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
        'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
        'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
      };
      
      const monthNum = monthNames[day];
      const dayNum = monthNames[month] || month.padStart(2, '0');
      const fullYear = year.length === 2 ? `20${year}` : year;
      
      return `${dayNum}/${monthNum}/${fullYear}`;
    }
    
    return dateString;
  };

  const checkDuplicateUtrs = async (data) => {
    const utrMap = new Map();
    const duplicateUtrs = [];

    // Check for duplicates within the CSV
    data.forEach((row, index) => {
      if (row.utr && row.utr.trim()) {
        const utr = row.utr.trim();
        if (utrMap.has(utr)) {
          utrMap.get(utr).push(index);
        } else {
          utrMap.set(utr, [index]);
        }
      }
    });

    // Check for duplicates in database and CSV
    for (const [utr, indices] of utrMap) {
      try {
        const { data: existingTransfers } = await supabase
          .from('inter_bank_transfers')
          .select('utr, id, from_bank, to_bank, amount_inr, date')
          .eq('utr', utr);

        const totalTransfersWithUtr = (existingTransfers?.length || 0) + indices.length;

        // Only show as duplicate if there are more than 2 transfers with the same UTR
        // (2 transfers = sent and received, which is a perfect match)
        if (totalTransfersWithUtr > 2) {
          duplicateUtrs.push({
            utr,
            csvIndices: indices,
            existingTransfers: existingTransfers || [],
            type: 'duplicate',
            totalCount: totalTransfersWithUtr
          });
        }
      } catch (error) {
        console.error('Error checking UTR:', error);
      }
    }

    setDuplicateUtrs(duplicateUtrs);
  };

  const updateRow = (rowId, field, value) => {
    const newData = [...tableData];
    const rowIndex = newData.findIndex(row => row.id === rowId);
    
    if (rowIndex === -1) return;

    const row = { ...newData[rowIndex] };
    
         // Special handling for date field
     if (field === 'date') {
       let formattedValue = value;
       
       // Check if it's in MM-DD-YYYY format and convert it
       const convertedDate = convertDateFormat(value);
       if (convertedDate !== value) {
         formattedValue = convertedDate;
         value = convertedDate;
       } else {
         // Auto-insert slashes at appropriate positions for DD/MM/YYYY format
         let cleanedValue = value.replace(/[^\d/]/g, '');
         
         if (cleanedValue.length >= 2 && !cleanedValue.includes('/')) {
           cleanedValue = cleanedValue.slice(0, 2) + '/' + cleanedValue.slice(2);
         }
         if (cleanedValue.length >= 5 && cleanedValue.split('/').length === 2) {
           cleanedValue = cleanedValue.slice(0, 5) + '/' + cleanedValue.slice(5);
         }
         
         // Limit to DD/MM/YYYY format (10 characters)
         if (cleanedValue.length > 10) {
           cleanedValue = cleanedValue.slice(0, 10);
         }
         
         formattedValue = cleanedValue;
         value = formattedValue;
       }
     }

    // Update the field
    row[field] = value;
    
    // Clear previous errors for this field
    if (row.errors) {
      row.errors[field] = null;
    }

    // Validate the updated field
    const errors = { ...row.errors };
    
    if (field === 'fromBank') {
      if (!value || value.trim() === '') {
        errors.fromBank = 'From Bank is required';
      }
    }

    if (field === 'toBank') {
      if (!value || value.trim() === '') {
        errors.toBank = 'To Bank is required';
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
         const convertedDate = convertDateFormat(value.trim());
         if (!validateDate(convertedDate)) {
           errors.date = 'Invalid date format (DD/MM/YYYY or MM-DD-YYYY)';
         }
       }
     }

    if (field === 'utr') {
      // Remove commas from UTR
      value = value.replace(/,/g, '');
      if (value && value.trim() !== '' && value.trim().length < 3) {
        errors.utr = 'UTR must be at least 3 characters';
      }
    }

    row.errors = errors;
    newData[rowIndex] = row;
    setTableData(newData);

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
      // Check for duplicates in inter_bank_transfers table
      const { data: existingTransfers, error } = await supabase
        .from('inter_bank_transfers')
        .select('utr')
        .eq('utr', utr);

      if (error) throw error;

      const existingCount = existingTransfers?.length || 0;
      
      // Count how many times this UTR appears in the current CSV data
      const csvCount = tableData.filter(row => row.utr === utr).length;
      const totalCount = existingCount + csvCount;

      // Only show as duplicate if there are more than 2 transfers with this UTR
      // (2 transfers = sent and received, which is a perfect match)
      const isDuplicate = totalCount > 2;

      setUtrValidation(prev => ({
        ...prev,
        [rowId]: {
          isValid: !isDuplicate,
          message: isDuplicate 
            ? `UTR has ${totalCount} transfers (should be 2 for sent + received)` 
            : existingCount > 0 
              ? `UTR found in database (${existingCount} existing + ${csvCount} new = ${totalCount} total)` 
              : 'UTR is available'
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

  const toggleRowApproval = (rowId) => {
    const newData = [...tableData];
    const rowIndex = newData.findIndex(row => row.id === rowId);
    
    if (rowIndex !== -1) {
      newData[rowIndex].approved = !newData[rowIndex].approved;
      setTableData(newData);
    }
  };

  const approveAllValid = () => {
    const newData = [...tableData];
    newData.forEach(row => {
      if (!hasErrors(row)) {
        row.approved = true;
      }
    });
    setTableData(newData);
  };

  const addRow = () => {
    const newId = Math.max(...tableData.map(row => row.id), -1) + 1;
    const newRow = {
      id: newId,
      fromBank: '',
      toBank: '',
      amount: '',
      date: format(new Date(), 'dd/MM/yyyy'),
      utr: '',
      notes: '',
      errors: {},
      originalRow: {},
      approved: false
    };
    setTableData([...tableData, newRow]);
  };

  const removeRow = (rowId) => {
    setTableData(tableData.filter(row => row.id !== rowId));
  };

  const hasErrors = (row) => {
    return row.errors && Object.values(row.errors).some(error => error !== null);
  };

  const getValidRows = () => {
    return tableData.filter(row => {
      return row.fromBank && 
             row.toBank && 
             row.amount && 
             row.date && 
             !hasErrors(row) &&
             row.approved;
    });
  };

  const deleteDuplicateUtrs = async () => {
    if (duplicateUtrs.length === 0) return;
    
    setDeletingUtrs(true);
    
    try {
      // Get all UTRs to delete from database
      const utrsToDelete = duplicateUtrs.map(item => item.utr);
      
      if (utrsToDelete.length > 0) {
        // Delete all transfers with duplicate UTRs
        const { error } = await supabase
          .from('inter_bank_transfers')
          .delete()
          .in('utr', utrsToDelete);

        if (error) throw error;
      }
      
      const totalDeleted = duplicateUtrs.reduce((sum, item) => sum + item.existingTransfers.length, 0);
      setMessage(`Successfully deleted ${totalDeleted} duplicate UTR(s) from database`);
      setDuplicateUtrs([]);
      
      // Re-validate the data after deletion
      await checkDuplicateUtrs(tableData);
      
    } catch (error) {
      console.error('Error deleting duplicate UTRs:', error);
      setMessage('Error deleting duplicate UTRs');
    } finally {
      setDeletingUtrs(false);
    }
  };

  const handleSave = async () => {
    const validRows = getValidRows();
    
    if (validRows.length === 0) {
      setMessage('Please approve at least one valid row before saving');
      return;
    }

    setLoading(true);
    try {
      // Prepare data for insertion
      const dataToInsert = validRows.map(row => {
        // Convert date to YYYY-MM-DD format for database
        let dbDate = row.date;
        
        if (row.date.includes('/')) {
          const [day, month, year] = row.date.split('/');
          dbDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }

        return {
          from_bank: row.fromBank,
          to_bank: row.toBank,
          amount_inr: parseFloat(row.amount.toString().replace(/[^\d.-]/g, '')),
          date: dbDate,
          utr: row.utr || null,
          notes: row.notes
        };
      });

      // Insert data
      const { error } = await supabase
        .from('inter_bank_transfers')
        .insert(dataToInsert);

      if (error) throw error;

      setMessage(`Successfully imported ${validRows.length} inter bank transfer(s)`);
      onSave && onSave(validRows.length);
    } catch (error) {
      console.error('Error importing inter bank transfers:', error);
      setMessage('Error importing inter bank transfers. Please try again.');
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
      'From Bank': row.fromBank,
      'To Bank': row.toBank,
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
    link.setAttribute('download', 'corrected_inter_bank_transfers.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const cleanAllUtrs = () => {
    const cleanedData = tableData.map(row => ({
      ...row,
      utr: row.utr.replace(/,/g, '') // Remove all commas from UTR
    }));
    setTableData(cleanedData);
    setMessage('All UTRs cleaned successfully');
  };

  return (
    <div className="bulk-upload-editor">
      <div className="editor-header">
        <div>
          <h3>Inter Bank Transfers Bulk Upload Editor</h3>
          <p style={{ color: '#666', marginTop: '0.5rem' }}>
            Review and edit your CSV data before importing. Check the approval box for rows you want to import.
          </p>
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
            onClick={approveAllValid} 
            className="btn btn-secondary"
            disabled={loading}
          >
            Approve All Valid
          </button>
          <button 
            onClick={cleanAllUtrs} 
            className="btn btn-secondary"
            disabled={loading}
            title="Remove commas from all UTR numbers"
          >
            Clean All UTRs
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

             {/* Duplicate UTR Section */}
       {duplicateUtrs.length > 0 && (
         <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '4px' }}>
           <h5 style={{ margin: '0 0 0.5rem 0', color: '#92400e' }}>
             ⚠️ Multiple UTRs Found ({duplicateUtrs.length})
           </h5>
           <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#92400e' }}>
             The following UTRs have more than 2 transfers (sent + received). This indicates duplicate transactions.
           </p>
           
           <div style={{ marginBottom: '1rem' }}>
             {duplicateUtrs.map((item, index) => (
               <div key={index} style={{ marginBottom: '0.5rem', padding: '0.5rem', backgroundColor: 'white', borderRadius: '4px' }}>
                 <strong>UTR: {item.utr}</strong>
                 <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                   Total transfers with this UTR: {item.totalCount} (should be 2 for sent + received)
                 </div>
                 <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                   CSV rows: {item.csvIndices.map(i => i + 1).join(', ')}
                 </div>
                 {item.existingTransfers.length > 0 && (
                   <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                     Existing database transfers: {item.existingTransfers.length}
                     {item.existingTransfers.map((transfer, idx) => (
                       <div key={idx} style={{ marginLeft: '1rem', fontSize: '0.75rem' }}>
                         • {transfer.from_bank} → {transfer.to_bank} | ₹{transfer.amount_inr.toLocaleString()} | {format(new Date(transfer.date), 'dd/MM/yyyy')}
                       </div>
                     ))}
                   </div>
                 )}
               </div>
             ))}
           </div>
           
           <button 
             onClick={deleteDuplicateUtrs}
             className="btn btn-warning"
             disabled={deletingUtrs}
             style={{ marginRight: '0.5rem' }}
           >
             {deletingUtrs ? 'Deleting...' : `Delete ${duplicateUtrs.reduce((sum, item) => sum + item.existingTransfers.length, 0)} Database UTR(s)`}
           </button>
           <span style={{ fontSize: '0.8rem', color: '#92400e' }}>
             This will permanently delete the existing transfers with these UTRs to resolve duplicates.
           </span>
         </div>
       )}

             <div className="table-container">
         <table className="excel-table">
           <thead>
             <tr>
               <th>
                 <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                   <input
                     type="checkbox"
                     checked={tableData.length > 0 && tableData.every(row => !hasErrors(row) && row.approved)}
                     onChange={(e) => {
                       const newData = [...tableData];
                       newData.forEach(row => {
                         if (!hasErrors(row)) {
                           row.approved = e.target.checked;
                         }
                       });
                       setTableData(newData);
                     }}
                     disabled={tableData.length === 0}
                     title="Select all valid rows"
                   />
                   <span style={{ fontSize: '0.8rem', color: '#666' }}>All</span>
                 </div>
               </th>
               <th>Row</th>
               <th>From Bank *</th>
               <th>To Bank *</th>
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
              <tr key={row.id} className={`${hasErrors(row) ? 'has-errors' : 'valid-row'}`}>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={row.approved}
                    onChange={() => toggleRowApproval(row.id)}
                    disabled={hasErrors(row)}
                  />
                </td>
                <td>{index + 1}</td>
                
                {/* From Bank */}
                <td>
                  <input
                    type="text"
                    value={row.fromBank}
                    onChange={(e) => updateRow(row.id, 'fromBank', e.target.value)}
                    className={row.errors?.fromBank ? 'error' : ''}
                    placeholder="Enter from bank"
                  />
                  {row.errors?.fromBank && (
                    <div className="error-message">{row.errors.fromBank}</div>
                  )}
                </td>

                {/* To Bank */}
                <td>
                  <input
                    type="text"
                    value={row.toBank}
                    onChange={(e) => updateRow(row.id, 'toBank', e.target.value)}
                    className={row.errors?.toBank ? 'error' : ''}
                    placeholder="Enter to bank"
                  />
                  {row.errors?.toBank && (
                    <div className="error-message">{row.errors.toBank}</div>
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
                     placeholder="DD/MM/YYYY or MM-DD-YYYY"
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
                    className={row.errors?.utr ? 'error' : ''}
                    placeholder="Enter UTR"
                  />
                  {utrValidation[row.id] && (
                    <div className={`validation-message ${utrValidation[row.id].isValid ? 'valid' : 'invalid'}`}>
                      {utrValidation[row.id].message}
                    </div>
                  )}
                  {row.errors?.utr && (
                    <div className="error-message">{row.errors.utr}</div>
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
          <p>Valid Rows: {tableData.filter(row => !hasErrors(row)).length}</p>
          <p>Approved Rows: {tableData.filter(row => row.approved).length}</p>
          <p>Rows with Errors: {tableData.filter(hasErrors).length}</p>
        </div>
        <div className="actions">
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
          >
            {loading ? 'Saving...' : `Save ${getValidRows().length} Approved Transfer(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default InterBankTransfersBulkEditor;
