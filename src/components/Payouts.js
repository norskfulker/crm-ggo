import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase';
import { format } from 'date-fns';
import Papa from 'papaparse';
import BulkUploadEditor from './BulkUploadEditor';
import { normalizeDate, parseAmount, parseStatementText } from '../utils/statementParser';
import BankSearchPanel from './BankSearchPanel';
import { nameFromEmail, payoutAmountFor, toDisplayDate, isPayunie } from '../utils/bankSearch';

// Rows in the "Add Multiple Payouts" table get a stable id so that removing a row
// doesn't shift per-row state (UTR validation, open dropdown) onto its neighbours.
let excelRowId = 0;
const createExcelRow = (overrides = {}) => ({
  id: ++excelRowId,
  customer_email: '',
  amount_inr: '',
  date: '',
  utr: '',
  payunie: false,
  ...overrides
});

function Payouts() {
  const [payouts, setPayouts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPayout, setEditingPayout] = useState(null);
  const [formData, setFormData] = useState({
    customer_id: '',
    payouts: [
      {
        amount_inr: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        notes: ''
      }
    ]
  });
  const [message, setMessage] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedPayouts, setSelectedPayouts] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  
  // New state for grouped view
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'grouped'
  const [searchTerm, setSearchTerm] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [hasMoreData, setHasMoreData] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [paymentsData, setPaymentsData] = useState([]);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);
  const [totalLoaded, setTotalLoaded] = useState(0);
  
  // Customer search state
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  
  // Customer dropdown search state
  const [showCustomerSearchDropdown, setShowCustomerSearchDropdown] = useState(false);
  const [selectedCustomerForFilter, setSelectedCustomerForFilter] = useState(null);
  const [customerSearchInput, setCustomerSearchInput] = useState('');
  
  // Multi-email search state
  const [showMultiEmailDropdown, setShowMultiEmailDropdown] = useState(false);
  const [matchingCustomers, setMatchingCustomers] = useState([]);
  const [selectedCustomersForFilter, setSelectedCustomersForFilter] = useState([]);
  const [currentSearchTerm, setCurrentSearchTerm] = useState('');
  const [searchHistory, setSearchHistory] = useState([]);
  
  // New state for Excel-like table
  const [excelTableData, setExcelTableData] = useState(() => [createExcelRow()]);
  const [showExcelTable, setShowExcelTable] = useState(false);
  const [openExcelDropdownId, setOpenExcelDropdownId] = useState(null);
  const [utrValidation, setUtrValidation] = useState({});
  // Bank Search inside "Add Multiple Payouts": follows the row being edited
  const [bankFocusRowId, setBankFocusRowId] = useState(null);
  const [showBankSearch, setShowBankSearch] = useState(true);
  
  // Duplicate UTR deletion state
  const [duplicateUtrs, setDuplicateUtrs] = useState([]);
  const [showDuplicateUtrs, setShowDuplicateUtrs] = useState(false);
  const [deletingUtrs, setDeletingUtrs] = useState(false);

  // CSV Upload state
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [fileInputRef] = useState(React.createRef());
  
  // Bulk Upload Editor state
  const [showBulkEditor, setShowBulkEditor] = useState(false);
  const [bulkEditorData, setBulkEditorData] = useState([]);
  
  // Missing entries table state
  const [showMissingEntriesTable, setShowMissingEntriesTable] = useState(false);
  const [missingEntriesData, setMissingEntriesData] = useState([]);
  const [missingEntriesLoading, setMissingEntriesLoading] = useState(false);
  
  // Sorting state
  const [sortColumn, setSortColumn] = useState('date'); // Default sort by date
  const [sortDirection, setSortDirection] = useState('desc'); // Default descending

  // Utility function to normalize UUIDs for comparison
  const normalizeUUID = (uuid) => {
    if (!uuid) return null;
    return String(uuid).toLowerCase().trim();
  };

  // Helper function to check for duplicate UTRs with pagination
  const checkDuplicateUtrsInDatabase = async (utrsToCheck) => {
    if (!utrsToCheck || utrsToCheck.length === 0) return [];
    
    try {
      console.log(`Checking ${utrsToCheck.length} UTRs for duplicates...`);
      
      // Get all UTRs from payments table with pagination
      let allPaymentsData = [];
      let hasMorePayments = true;
      let fromPayments = 0;
      const pageSize = 1000;
      
      while (hasMorePayments) {
        const { data: paymentsPage, error: paymentsError } = await supabase
          .from('payments')
          .select('utr')
          .not('utr', 'is', null)
          .range(fromPayments, fromPayments + pageSize - 1);

        if (paymentsError) throw paymentsError;
        
        if (paymentsPage && paymentsPage.length > 0) {
          allPaymentsData = [...allPaymentsData, ...paymentsPage];
          fromPayments += pageSize;
          
          if (paymentsPage.length < pageSize) {
            hasMorePayments = false;
          }
        } else {
          hasMorePayments = false;
        }
      }

      // Get all UTRs from payouts table with pagination
      let allPayoutsData = [];
      let hasMorePayouts = true;
      let fromPayouts = 0;
      
      while (hasMorePayouts) {
        const { data: payoutsPage, error: payoutsError } = await supabase
          .from('payouts')
          .select('notes')
          .not('notes', 'is', null)
          .range(fromPayouts, fromPayouts + pageSize - 1);

        if (payoutsError) throw payoutsError;
        
        if (payoutsPage && payoutsPage.length > 0) {
          allPayoutsData = [...allPayoutsData, ...payoutsPage];
          fromPayouts += pageSize;
          
          if (payoutsPage.length < pageSize) {
            hasMorePayouts = false;
          }
        } else {
          hasMorePayouts = false;
        }
      }

      const existingUtrs = [
        ...allPaymentsData.map(p => p.utr),
        ...allPayoutsData.map(p => p.notes)
      ];

      const duplicateUtrs = utrsToCheck.filter(utr => existingUtrs.includes(utr));
      console.log(`Found ${duplicateUtrs.length} duplicate UTRs:`, duplicateUtrs);
      
      return duplicateUtrs;
    } catch (error) {
      console.error('Error checking duplicate UTRs:', error);
      return [];
    }
  };

  useEffect(() => {
    fetchData();
    
    // Debug function for the specific customer (removed console logs)
    window.debugPayoutsForCustomer = async () => {
      const customerId = '4b96557b-a516-4d66-b95e-9f279e8a8502';
      
      // Get all payouts for this customer
      const { data: payouts, error: payoutsError } = await supabase
        .from('payouts')
        .select(`
          *,
          customers (email)
        `)
        .eq('customer_id', customerId)
        .limit(10000);
      
      if (payoutsError) {
        console.error('Error fetching payouts:', payoutsError);
        return;
      }
      
      // Check current payouts state
      const currentPayouts = payouts.filter(p => normalizeUUID(p.customer_id) === normalizeUUID(customerId));
    };
    
    return () => {
      delete window.debugPayoutsForCustomer;
    };
  }, []);

  // No need to refetch data when search term changes since we only load customer-specific data

  // Effect to handle customer search changes
  useEffect(() => {
    // Only fetch data if we have already loaded initial data
    if (customers.length > 0) {
      fetchCustomersData();
    }
  }, [customerSearchTerm]); // Only refetch when search term changes

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.customer-dropdown-container')) {
        setShowCustomerDropdown(false);
      }
      // Close customer search dropdown when clicking outside
      if (!event.target.closest('.customer-search-dropdown-container')) {
        setShowCustomerSearchDropdown(false);
      }
      // Close multi-email dropdown when clicking outside
      if (!event.target.closest('.multi-email-dropdown-container')) {
        setShowMultiEmailDropdown(false);
      }
      // Close all row customer dropdowns when clicking outside
      if (!event.target.closest('.row-customer-dropdown')) {
        setOpenExcelDropdownId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const fetchData = async () => {
    try {
      // Fetch initial paginated customers
      await fetchCustomersData();
      
      // Fetch payments data
      await fetchPaymentsData();
      
      // Don't fetch all payouts initially - only when a customer is selected
      setPayouts([]);
      setTotalCount(0);
      setHasMoreData(false);
    } catch (error) {
      console.error('Error fetching data:', error);
      setMessage('Error fetching data');
    } finally {
      setLoading(false);
    }
  };

  // Function to fetch all customers
  const fetchCustomersData = async () => {
    try {
      // First, get all customers
      const { data: allCustomers, error: customersError } = await supabase
        .from('customers')
        .select('id, email')
        .order('email', { ascending: true });

      if (customersError) throw customersError;

      // Then get customers with their most recent payout date for sorting
      const { data: customersWithPayouts, error: payoutsError } = await supabase
        .from('payouts')
        .select(`
          customer_id,
          created_at,
          customers!inner(id, email)
        `)
        .order('created_at', { ascending: false });

      if (payoutsError) throw payoutsError;

      // Create a map to get the most recent payout for each customer
      const customerPayoutMap = new Map();
      
      customersWithPayouts?.forEach(payout => {
        const customerId = payout.customer_id;
        const payoutDate = payout.created_at;
        
        if (!customerPayoutMap.has(customerId) || 
            new Date(payoutDate) > new Date(customerPayoutMap.get(customerId).latestPayoutDate)) {
          customerPayoutMap.set(customerId, {
            id: payout.customers.id,
            email: payout.customers.email,
            latestPayoutDate: payoutDate
          });
        }
      });

      // Combine all customers with payout information
      const allCustomersWithPayouts = allCustomers?.map(customer => ({
        id: customer.id,
        email: customer.email,
        latestPayoutDate: customerPayoutMap.get(customer.id)?.latestPayoutDate || null
      })) || [];

      // Sort customers: those with payouts first (by latest payout date), then those without payouts (by email)
      const sortedCustomers = allCustomersWithPayouts.sort((a, b) => {
        // If both have payouts, sort by latest payout date (descending)
        if (a.latestPayoutDate && b.latestPayoutDate) {
          return new Date(b.latestPayoutDate) - new Date(a.latestPayoutDate);
        }
        // If only one has payouts, put it first
        if (a.latestPayoutDate && !b.latestPayoutDate) return -1;
        if (!a.latestPayoutDate && b.latestPayoutDate) return 1;
        // If neither has payouts, sort by email
        return a.email.localeCompare(b.email);
      });

      // Apply search filter if needed
      let filteredCustomers = sortedCustomers;
      if (customerSearchTerm && customerSearchTerm.trim()) {
        const searchLower = customerSearchTerm.toLowerCase();
        filteredCustomers = sortedCustomers.filter(customer =>
          customer.email.toLowerCase().includes(searchLower)
        );
      }

      setCustomers(filteredCustomers.slice(0, 1000)); // Limit to 1000 results
    } catch (error) {
      console.error('Error fetching customers data:', error);
      setMessage('Error fetching customers data');
    }
  };

  // Function to fetch payments data
  const fetchPaymentsData = async () => {
    try {
      const { data: payments, error } = await supabase
        .from('payments')
        .select(`
          *,
          customers (email)
        `)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (error) throw error;
      setPaymentsData(payments || []);
    } catch (error) {
      console.error('Error fetching payments data:', error);
      setMessage('Error fetching payments data');
    }
  };

  // Function to fetch payouts with search and pagination
  const fetchPayoutsData = async (loadMore = false) => {
    try {
      if (!loadMore) {
        setLoading(true);
        setCurrentPage(0);
        setTotalLoaded(0);
      } else {
        setIsLoadingMore(true);
      }

      const pageSize = 1000;
      const from = loadMore ? currentPage * pageSize : 0;
      const to = from + pageSize - 1;
      
      let query = supabase
        .from('payouts')
        .select(`
          *,
          customers (email)
        `);

      // Apply search filter if search term exists (only for non-comma searches)
      if (searchTerm && searchTerm.trim() && !searchTerm.includes(',')) {
        const searchLower = searchTerm.toLowerCase();
        // Search across all fields
        query = query.or(`customers.email.ilike.%${searchLower}%`);
        query = query.or(`amount_inr::text.ilike.%${searchTerm}%`);
        query = query.or(`notes.ilike.%${searchLower}%`);
        query = query.or(`utr.ilike.%${searchLower}%`);
        query = query.or(`date::text.ilike.%${searchTerm}%`);
      }

      // Get paginated results - ordered by latest creation time
      query = query
        .order('created_at', { ascending: false })
        .range(from, to);

      const { data: payoutsData, error: payoutsError } = await query;

      if (payoutsError) throw payoutsError;

      // Update payouts data
      if (loadMore) {
        setPayouts(prev => [...prev, ...(payoutsData || [])]);
        setCurrentPage(prev => prev + 1);
        setTotalLoaded(prev => prev + (payoutsData?.length || 0));
      } else {
        setPayouts(payoutsData || []);
        setCurrentPage(1);
        setTotalLoaded(payoutsData?.length || 0);
      }

      setTotalCount(payoutsData?.length || 0);
      
      // Check if there might be more data (if we got exactly 1000 records)
      setHasMoreData((payoutsData?.length || 0) === pageSize);

      // Add gap time if loading more data
      if (loadMore && payoutsData?.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second gap
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setMessage('Error fetching data');
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
    }
  };

  // Excel-like table functions
  const isExcelRowValid = (row) =>
    row.customer_email && row.amount_inr > 0 && validateDate(row.date) && row.utr.trim();

  const closeExcelTable = () => {
    setShowExcelTable(false);
    setExcelTableData([createExcelRow()]);
    setOpenExcelDropdownId(null);
    setBankFocusRowId(null);
  };

  const addExcelRow = () => {
    // Carry forward the customer and date from the previous row
    const lastRow = excelTableData[excelTableData.length - 1];
    setExcelTableData([
      ...excelTableData,
      createExcelRow({
        customer_email: lastRow ? lastRow.customer_email : '',
        date: lastRow ? lastRow.date : ''
      })
    ]);
  };

  const removeExcelRow = (rowId) => {
    if (excelTableData.length > 1) {
      setExcelTableData(excelTableData.filter(row => row.id !== rowId));
    }
  };

  const updateExcelRow = (index, field, value) => {
    const newData = [...excelTableData];
    const rowId = newData[index].id;

    // Special handling for date field to ensure proper DD/MM/YYYY format
    if (field === 'date') {
      let formattedValue = value;

      // Month names ("09 Jan 23", "01-Mar-2023") are kept as typed and
      // converted to DD/MM/YYYY when the field loses focus (see normalizeExcelDate)
      if (/[A-Za-z]/.test(value)) {
        formattedValue = value.slice(0, 20);
      } else {
        // Handle regular DD/MM/YYYY format
        // Remove any non-numeric characters except forward slashes
        let cleanedValue = value.replace(/[^\d/]/g, '');
        
        // Auto-insert slashes at appropriate positions
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
      }
      
      value = formattedValue;
    }
    
    // Customer email: auto-select on an exact match (typed or pasted), otherwise show suggestions
    if (field === 'customer_email') {
      const existingCustomer = customers.find(customer =>
        customer.email.toLowerCase() === value.trim().toLowerCase()
      );
      if (existingCustomer) {
        value = existingCustomer.email;
        setOpenExcelDropdownId(null);
      } else {
        setOpenExcelDropdownId(rowId);
      }
    }

    newData[index] = {
      ...newData[index],
      [field]: value
    };
    // A UTR typed over the one from Bank Search unlinks the row, so that transaction shows in the list again
    if (field === 'utr' && newData[index].bank_txn_id) {
      const { bank_txn_id: _unlinked, ...unlinked } = newData[index];
      newData[index] = unlinked;
    }
    setExcelTableData(newData);

    // Live UTR validation for Excel table
    if (field === 'utr') {
      if (value.trim()) {
        validateUtrLive(value.trim(), `excel_${rowId}`);
      } else {
        setUtrValidation(prev => {
          const { [`excel_${rowId}`]: _removed, ...rest } = prev;
          return rest;
        });
      }
    }
  };

  const normalizeExcelDate = (index) => {
    const normalized = normalizeDate(excelTableData[index].date);
    if (normalized && normalized !== excelTableData[index].date) {
      updateExcelRow(index, 'date', normalized);
    }
  };

  // Pasting bank statement text into a row fills date, amount and UTR.
  // Several transactions in one paste fill this row and add rows below it.
  const handleExcelRowPaste = (e, index) => {
    const text = e.clipboardData.getData('text');
    const field = e.target.name;
    const parsed = parseStatementText(text);
    const entries = parsed.filter(entry => !entry.failed);
    const skipped = parsed.length - entries.length;

    if (entries.length === 0) {
      if (skipped > 0) {
        e.preventDefault();
        setMessage(`Pasted transfer(s) were not successful - nothing filled (${skipped} skipped)`);
        return;
      }
      // Single values: normalise a pasted date ("09 Jan 23") or amount ("2,970.00")
      const value = field === 'date' ? normalizeDate(text) : field === 'amount_inr' ? parseAmount(text) : null;
      if (value) {
        e.preventDefault();
        updateExcelRow(index, field, value);
      }
      return;
    }

    e.preventDefault();
    const baseRow = excelTableData[index];
    const filledRows = entries.map((entry, i) => ({
      ...(i === 0 ? baseRow : createExcelRow({ customer_email: baseRow.customer_email })),
      date: entry.date,
      amount_inr: entry.amount || (i === 0 ? baseRow.amount_inr : ''),
      utr: entry.utr || (i === 0 ? baseRow.utr : ''),
      payunie: Boolean(entry.payunie) || (i === 0 && baseRow.payunie)
    }));

    setExcelTableData([
      ...excelTableData.slice(0, index),
      ...filledRows,
      ...excelTableData.slice(index + 1)
    ]);
    filledRows.forEach(row => {
      if (row.utr) validateUtrLive(row.utr, `excel_${row.id}`);
    });
    const notes = [];
    if (entries.length > 1) notes.push(`Filled ${entries.length} rows from pasted statement`);
    if (skipped > 0) notes.push(`skipped ${skipped} unsuccessful transfer(s)`);
    setMessage(notes.join(', '));
  };

  // Bank Search "+ Add": fill the row being edited if its amount/UTR are empty, otherwise add a row
  // for the same customer. PayUnie transfers are grossed up and marked Payunie (account no. as UTR).
  const handleBankPick = (txn, { recorded } = {}) => {
    if (recorded) {
      const where = recorded.map(h => `${h.table}${h.email ? ` for ${h.email}` : ''}`).join(', ');
      if (!window.confirm(`UTR ${txn.reference} is already recorded (${where}). Add it anyway?`)) return;
    }
    const fields = {
      date: toDisplayDate(txn.txn_date),
      amount_inr: payoutAmountFor(txn),
      utr: txn.reference || '',
      payunie: isPayunie(txn),
      bank_txn_id: txn.id // hides this transaction from Bank Search while the row exists
    };
    const focusIndex = excelTableData.findIndex(r => r.id === bankFocusRowId);
    const targetIndex = focusIndex >= 0 ? focusIndex : excelTableData.length - 1;
    const target = excelTableData[targetIndex];
    let newRow;
    let newData;
    if (target && !target.amount_inr && !target.utr) {
      newRow = { ...target, ...fields };
      newData = excelTableData.map((r, i) => (i === targetIndex ? newRow : r));
    } else {
      newRow = createExcelRow({ customer_email: target ? target.customer_email : '', ...fields });
      newData = [...excelTableData.slice(0, targetIndex + 1), newRow, ...excelTableData.slice(targetIndex + 1)];
    }
    setExcelTableData(newData);
    setBankFocusRowId(newRow.id);
    if (newRow.utr) validateUtrLive(newRow.utr, `excel_${newRow.id}`);
    setMessage(`Added ${txn.party || 'bank transaction'} · ₹${newRow.amount_inr} · ${newRow.date}${isPayunie(txn) ? ` (PayUnie ₹${txn.amount} grossed up)` : ''}`);
  };

  // Bank Search "Edit saved": open the payout already saved for this transaction in the Edit Payout form
  const handleEditRecordedFromBank = (payout) => {
    handleEdit(payout);
    setTimeout(() => {
      const form = document.getElementById('payout-edit-form');
      if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  const handleExcelCustomerSelect = (customer, rowIndex) => {
    const newData = [...excelTableData];
    newData[rowIndex] = {
      ...newData[rowIndex],
      customer_email: customer.email
    };
    setExcelTableData(newData);
    setOpenExcelDropdownId(null);
  };

  const getFilteredExcelCustomers = (searchTerm) => {
    return customers
      .filter(customer => customer.email.toLowerCase().includes(searchTerm.toLowerCase()))
      .slice(0, 50);
  };

  const excelHeaderStyle = { padding: '0.6rem', border: '1px solid #ddd', textAlign: 'left' };
  const excelCellStyle = { padding: '0.4rem', border: '1px solid #ddd', verticalAlign: 'top' };
  const excelInputStyle = { width: '100%', padding: '0.45rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '0.9rem', boxSizing: 'border-box' };

  // Filter customers for dropdown search
  const getFilteredCustomersForSearch = () => {
    if (!customerSearchInput.trim()) return customers.slice(0, 100); // Show first 100 if no search
    
    return customers
      .filter(customer =>
        customer.email.toLowerCase().includes(customerSearchInput.toLowerCase())
      )
      .slice(0, 100); // Limit to 100 results for better performance
  };

  // Find matching customers for the current search term (breadcrumb style)
  const findMatchingCustomersForCurrentTerm = (searchTerm) => {
    if (!searchTerm || searchTerm.length === 0) {
      setMatchingCustomers([]);
      return;
    }

    console.log('Searching for current term:', searchTerm);
    console.log('Available customers:', customers.slice(0, 5).map(c => c.email));

    const matches = customers.filter(customer => {
      const customerEmail = customer.email.toLowerCase();
      const searchEmail = searchTerm.toLowerCase();
      
      // Strategy 1: Exact match
      if (customerEmail === searchEmail) return true;
      
      // Strategy 2: Contains match
      if (customerEmail.includes(searchEmail)) return true;
      
      // Strategy 3: Partial match (for cases like "akshaypathrot" matching "akshaypathrot@gmail.com")
      const emailParts = searchEmail.split('@')[0]; // Get part before @
      if (emailParts && customerEmail.includes(emailParts)) return true;
      
      // Strategy 4: Reverse partial match (for cases where search term is longer)
      if (searchEmail.includes('@') && customerEmail.includes(searchEmail.split('@')[0])) return true;
      
      return false;
    });

    console.log('Found matches for current term:', matches.map(m => m.email));
    setMatchingCustomers(matches);
  };

  // Find matching customers for multi-email search (legacy function)
  const findMatchingCustomers = (searchTerm) => {
    if (!searchTerm || !searchTerm.includes(',')) {
      setMatchingCustomers([]);
      return;
    }

    const emails = searchTerm.split(',').map(email => email.trim()).filter(email => email.length > 0);
    const matches = [];

    console.log('Searching for emails:', emails);
    console.log('Available customers:', customers.slice(0, 5).map(c => c.email)); // Log first 5 customers

    emails.forEach(email => {
      // Try multiple matching strategies
      const matchingCustomers = customers.filter(customer => {
        const customerEmail = customer.email.toLowerCase();
        const searchEmail = email.toLowerCase();
        
        // Strategy 1: Exact match
        if (customerEmail === searchEmail) return true;
        
        // Strategy 2: Contains match
        if (customerEmail.includes(searchEmail)) return true;
        
        // Strategy 3: Partial match (for cases like "akshaypathrot" matching "akshaypathrot@gmail.com")
        const emailParts = searchEmail.split('@')[0]; // Get part before @
        if (emailParts && customerEmail.includes(emailParts)) return true;
        
        // Strategy 4: Reverse partial match (for cases where search term is longer)
        if (searchEmail.includes('@') && customerEmail.includes(searchEmail.split('@')[0])) return true;
        
        return false;
      });

      matchingCustomers.forEach(customer => {
        if (!matches.find(m => m.id === customer.id)) {
          matches.push(customer);
        }
      });
    });

    console.log('Found matches:', matches.map(m => m.email));
    setMatchingCustomers(matches);
  };

  // Handle customer selection from dropdown (breadcrumb style)
  const handleCustomerSelectForFilter = (customer) => {
    // Add customer to multi-selection if we're in breadcrumb mode
    if (customerSearchInput.includes(',')) {
      handleMultiCustomerSelect(customer);
    } else {
      // Single customer selection (legacy behavior)
      setSelectedCustomerForFilter(customer);
      setCustomerSearchInput(customer.email);
      setSearchTerm(customer.email);
      setShowCustomerSearchDropdown(false);
      
      // Reset pagination when filtering by customer
      setCurrentPage(0);
      setTotalLoaded(0);
      
      // Fetch data for selected customer
      fetchPayoutsDataForSpecificCustomer(customer.id);
    }
  };

  // Clear customer filter
  const clearCustomerFilter = () => {
    setSelectedCustomerForFilter(null);
    setCustomerSearchInput('');
    setSearchTerm('');
    setShowCustomerSearchDropdown(false);
    
    // Reset pagination and clear data
    setCurrentPage(0);
    setTotalLoaded(0);
    setPayouts([]);
    setTotalCount(0);
    setHasMoreData(false);
  };

  // Handle multi-customer selection (breadcrumb style)
  const handleMultiCustomerSelect = (customer) => {
    // Add customer to selection
    setSelectedCustomersForFilter(prev => {
      if (!prev.find(c => c.id === customer.id)) {
        return [...prev, customer];
      }
      return prev;
    });
    
    // Update search term to include this customer as a breadcrumb
    const currentSearch = searchTerm;
    if (currentSearch.includes(',')) {
      const parts = currentSearch.split(',');
      const lastPart = parts[parts.length - 1].trim();
      
      // Replace the last part with the selected customer email
      const newParts = [...parts.slice(0, -1), customer.email];
      const newSearchTerm = newParts.join(', ') + ', ';
      
      setSearchTerm(newSearchTerm);
      setCurrentSearchTerm('');
      setMatchingCustomers([]);
      setShowMultiEmailDropdown(false);
    } else {
      // First customer selection
      setSearchTerm(customer.email + ', ');
      setCurrentSearchTerm('');
      setMatchingCustomers([]);
      setShowMultiEmailDropdown(false);
    }
  };

  // Apply multi-customer filter
  const applyMultiCustomerFilter = () => {
    if (selectedCustomersForFilter.length === 0) {
      clearCustomerFilter();
      return;
    }

    // Fetch payouts for selected customers
    fetchPayoutsForSelectedCustomers(selectedCustomersForFilter);
    setShowMultiEmailDropdown(false);
  };

  // Clear multi-customer filter
  const clearMultiCustomerFilter = () => {
    setSelectedCustomersForFilter([]);
    setMatchingCustomers([]);
    setSearchTerm('');
    setCurrentSearchTerm('');
    clearCustomerFilter();
  };

  // Remove individual customer from breadcrumb
  const removeCustomerFromBreadcrumb = (customerToRemove) => {
    setSelectedCustomersForFilter(prev => prev.filter(c => c.id !== customerToRemove.id));
    
    // Update search term to remove this customer
    const currentSearch = searchTerm;
    if (currentSearch.includes(',')) {
      const parts = currentSearch.split(',').map(p => p.trim()).filter(p => p.length > 0);
      const newParts = parts.filter(part => part !== customerToRemove.email);
      
      if (newParts.length > 0) {
        setSearchTerm(newParts.join(', ') + ', ');
      } else {
        setSearchTerm('');
        setCurrentSearchTerm('');
      }
    } else {
      setSearchTerm('');
      setCurrentSearchTerm('');
    }
  };

  // Fetch payouts for multiple selected customers
  const fetchPayoutsForSelectedCustomers = async (selectedCustomers) => {
    try {
      setLoading(true);
      
      const customerIds = selectedCustomers.map(c => c.id);
      
      const { data: allPayoutsData, error: payoutsError } = await supabase
        .from('payouts')
        .select(`
          *,
          customers (email)
        `)
        .in('customer_id', customerIds);

      if (payoutsError) throw payoutsError;

      // Sort all payouts by date (newest first)
      const sortedPayouts = (allPayoutsData || []).sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateB - dateA; // Descending order (newest first)
      });

      setPayouts(sortedPayouts);
      setTotalCount(sortedPayouts.length);
      setTotalLoaded(sortedPayouts.length);
      setHasMoreData(false);
      setCurrentPage(0);
      
    } catch (error) {
      console.error('Error fetching payouts for selected customers:', error);
      setMessage('Error fetching payouts for selected customers');
    } finally {
      setLoading(false);
    }
  };

  // Fetch ALL payouts for specific customer (no pagination limit)
  const fetchPayoutsDataForSpecificCustomer = async (customerId) => {
    try {
      setLoading(true);
      
      // Fetch ALL payouts for this customer in one go (without range limit)
      const { data: allPayoutsData, error: payoutsError } = await supabase
        .from('payouts')
        .select(`
          *,
          customers (email)
        `)
        .eq('customer_id', customerId);

      if (payoutsError) throw payoutsError;

      // Sort all payouts by date (newest first) to ensure proper ordering
      const sortedPayouts = (allPayoutsData || []).sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        
        // Debug logging for first few comparisons
        if (Math.random() < 0.01) { // Log only 1% of comparisons to avoid spam
          console.log(`Comparing: ${a.date} (${dateA}) vs ${b.date} (${dateB})`);
        }
        
        return dateB - dateA; // Descending order (newest first)
      });
      
      // Debug: Log first few sorted dates
      console.log('First 10 sorted dates:', sortedPayouts.slice(0, 10).map(p => p.date));
      console.log('Total payouts fetched:', sortedPayouts.length);

      // Set all the data at once
      setPayouts(sortedPayouts);
      setTotalCount(sortedPayouts.length);
      setTotalLoaded(sortedPayouts.length);
      setHasMoreData(false); // No more data since we fetched everything
      setCurrentPage(0);
      
    } catch (error) {
      console.error('Error fetching customer payouts:', error);
      setMessage('Error fetching customer payouts');
    } finally {
      setLoading(false);
      setIsLoadingMore(false);
    }
  };

  // Live UTR validation function for Excel table
  const validateUtrLive = async (utr, index) => {
    try {
      // Check for duplicates in payments table
      const { data: existingPayments, error: paymentsCheckError } = await supabase
        .from('payments')
        .select('utr, customers(email)')
        .eq('utr', utr);

      if (paymentsCheckError) throw paymentsCheckError;

      // Check for duplicates in payouts table (using notes field as UTR)
      const { data: existingPayouts, error: payoutsCheckError } = await supabase
        .from('payouts')
        .select('notes, customers(email)')
        .eq('notes', utr);

      if (payoutsCheckError) throw payoutsCheckError;

      const hasPaymentDuplicate = existingPayments && existingPayments.length > 0;
      const hasPayoutDuplicate = existingPayouts && existingPayouts.length > 0;
      const isDuplicate = hasPaymentDuplicate || hasPayoutDuplicate;

      let message = 'UTR is available';
      if (isDuplicate) {
        const locations = [];
        if (hasPaymentDuplicate) {
          const customerEmails = existingPayments.map(p => p.customers?.email || 'Unknown').join(', ');
          locations.push(`Payments (Customer: ${customerEmails})`);
        }
        if (hasPayoutDuplicate) {
          const customerEmails = existingPayouts.map(p => p.customers?.email || 'Unknown').join(', ');
          locations.push(`Payouts (Customer: ${customerEmails})`);
        }
        message = `UTR already exists in: ${locations.join(', ')}`;
      }

      setUtrValidation(prev => ({
        ...prev,
        [index]: {
          isValid: !isDuplicate,
          message: message
        }
      }));
    } catch (error) {
      console.error('Error validating UTR:', error);
      setUtrValidation(prev => ({
        ...prev,
        [index]: {
          isValid: false,
          message: 'Error checking UTR availability'
        }
      }));
    }
  };

  // Live UTR validation function for single payout form
  const validateUtrLiveSingle = async (utr, index) => {
    try {
      // Check for duplicates in payments table
      const { data: existingPayments, error: paymentsCheckError } = await supabase
        .from('payments')
        .select('utr, customers(email)')
        .eq('utr', utr);

      if (paymentsCheckError) throw paymentsCheckError;

      // Check for duplicates in payouts table (using notes field as UTR)
      const { data: existingPayouts, error: payoutsCheckError } = await supabase
        .from('payouts')
        .select('notes, customers(email)')
        .eq('notes', utr);

      if (payoutsCheckError) throw payoutsCheckError;

      const hasPaymentDuplicate = existingPayments && existingPayments.length > 0;
      const hasPayoutDuplicate = existingPayouts && existingPayouts.length > 0;
      const isDuplicate = hasPaymentDuplicate || hasPayoutDuplicate;

      let message = 'UTR is available';
      if (isDuplicate) {
        const locations = [];
        if (hasPaymentDuplicate) {
          const customerEmails = existingPayments.map(p => p.customers?.email || 'Unknown').join(', ');
          locations.push(`Payments (Customer: ${customerEmails})`);
        }
        if (hasPayoutDuplicate) {
          const customerEmails = existingPayouts.map(p => p.customers?.email || 'Unknown').join(', ');
          locations.push(`Payouts (Customer: ${customerEmails})`);
        }
        message = `UTR already exists in: ${locations.join(', ')}`;
      }

      setUtrValidation(prev => ({
        ...prev,
        [`single_${index}`]: {
          isValid: !isDuplicate,
          message: message
        }
      }));
    } catch (error) {
      console.error('Error validating UTR:', error);
      setUtrValidation(prev => ({
        ...prev,
        [`single_${index}`]: {
          isValid: false,
          message: 'Error checking UTR availability'
        }
      }));
    }
  };

  // Auto-fix date format to DD/MM/YYYY
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

  // Validate date format and range
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
             fullYear >= 2022 && fullYear <= 2023;
    }
    
    // Check if it matches DD/MM/YYYY format
    const dateRegex = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(202[23])$/;
    if (!dateRegex.test(dateString)) return false;
    
    // Additional validation for valid dates
    const [day, month, year] = dateString.split('/').map(Number);
    const date = new Date(year, month - 1, day);
    
    return date.getFullYear() === year && 
           date.getMonth() === month - 1 && 
           date.getDate() === day;
  };

  const handleExcelSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

              try {
               // Validate data
        const validRows = excelTableData.filter(isExcelRowValid);

               if (validRows.length === 0) {
          setMessage('Please add at least one valid payout row with customer, amount, date and UTR');
          setLoading(false);
          return;
        }

       // Get customer IDs for all emails
       const customerEmails = [...new Set(validRows.map(row => row.customer_email))];
       const { data: customerData, error: customerError } = await supabase
         .from('customers')
         .select('id, email')
         .in('email', customerEmails);

       if (customerError) throw customerError;

       const customerMap = {};
       customerData.forEach(customer => {
         customerMap[customer.email] = customer.id;
       });

       // Check for missing customers
       const missingEmails = customerEmails.filter(email => !customerMap[email]);
       if (missingEmails.length > 0) {
         setMessage(`Customers not found: ${missingEmails.join(', ')}`);
         setLoading(false);
         return;
       }

      // Check for UTR duplicates with Payunie validation
      const utrsToCheck = validRows
        .map(row => row.utr)
        .filter(utr => utr && utr.trim() !== '');

      // First check for duplicates within the same form
      const utrCounts = new Map();
      const formDuplicates = [];
      
      for (const row of validRows) {
        const utr = row.utr;
        if (utr && utr.trim()) {
          const utrLower = utr.toLowerCase();
          if (utrCounts.has(utrLower)) {
            if (!row.payunie) {
              formDuplicates.push(utr);
            }
          } else {
            utrCounts.set(utrLower, 1);
          }
        }
      }

      if (formDuplicates.length > 0) {
        setMessage(`Duplicate UTR(s) found in the form: ${formDuplicates.join(', ')}. Please use different UTRs or tick "Payunie" on those rows to allow duplicates.`);
        setLoading(false);
        return;
      }

      // Then check for duplicates with existing database UTRs
      if (utrsToCheck.length > 0) {
        const duplicateUtrs = await checkDuplicateUtrsInDatabase(utrsToCheck);
        
        // Existing UTRs are only allowed on rows marked as Payunie
        const invalidDuplicates = duplicateUtrs.filter(utr =>
          validRows.some(row => row.utr === utr && !row.payunie)
        );

        if (invalidDuplicates.length > 0) {
          setMessage(`UTR(s) already exist in database: ${invalidDuplicates.join(', ')}. Please use a different UTR or tick "Payunie" on those rows to allow duplicates.`);
          setLoading(false);
          return;
        }
      }

                    // Prepare payouts for insertion
        const payoutsToInsert = validRows.map(row => {
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
          
          return {
            customer_id: customerMap[row.customer_email],
            amount_inr: parseFloat(row.amount_inr),
            date: dbDate,
            notes: row.utr // Store UTR in notes field for database compatibility
          };
        });

      const { error } = await supabase
        .from('payouts')
        .insert(payoutsToInsert);

      if (error) throw error;
      setMessage(`Successfully added ${validRows.length} payout(s)`);
      
      closeExcelTable();
      fetchData();
      
      // Refresh customers list to update payout totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
    } catch (error) {
      console.error('Error saving payouts:', error);
      setMessage('Error saving payouts');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate that a customer is selected
      if (!formData.customer_id) {
        setMessage('Please select a customer');
        setLoading(false);
        return;
      }

      if (editingPayout) {
        // Handle single payout edit
        // Validate UTR is provided for payouts
        if (!formData.payouts[0].notes || !formData.payouts[0].notes.trim()) {
          setMessage('UTR is required for payouts');
          setLoading(false);
          return;
        }
        
        const payoutData = {
          customer_id: formData.customer_id,
          amount_inr: parseFloat(formData.payouts[0].amount_inr),
          date: formData.payouts[0].date,
          notes: formData.payouts[0].notes
        };

        const { error } = await supabase
          .from('payouts')
          .update(payoutData)
          .eq('id', editingPayout.id);

        if (error) throw error;
        setMessage('Payout updated successfully');
      } else {
        // Handle multiple payouts insert
        const validPayouts = formData.payouts.filter(payout => 
          payout.amount_inr && payout.amount_inr > 0 && payout.notes && payout.notes.trim()
        );

        if (validPayouts.length === 0) {
          setMessage('Please add at least one payout with a valid amount and UTR');
          setLoading(false);
          return;
        }

        // Check for UTR duplicates (using notes field as UTR)
        const utrsToCheck = validPayouts
          .map(payout => payout.notes)
          .filter(utr => utr && utr.trim() !== '');

        if (utrsToCheck.length > 0) {
          // Check for duplicates in payments table
          const { data: existingPayments, error: paymentsCheckError } = await supabase
            .from('payments')
            .select('utr')
            .in('utr', utrsToCheck);

          if (paymentsCheckError) throw paymentsCheckError;

          // Check for duplicates in payouts table (using notes field)
          const { data: existingPayouts, error: payoutsCheckError } = await supabase
            .from('payouts')
            .select('notes')
            .in('notes', utrsToCheck);

          if (payoutsCheckError) throw payoutsCheckError;

          const existingUtrs = [
            ...(existingPayments || []).map(p => p.utr),
            ...(existingPayouts || []).map(p => p.notes)
          ];

          const duplicateUtrs = utrsToCheck.filter(utr => existingUtrs.includes(utr));

          if (duplicateUtrs.length > 0) {
            setMessage(`UTR(s) already exist: ${duplicateUtrs.join(', ')}. Please use a different UTR.`);
            setLoading(false);
            return;
          }
        }

        const payoutsToInsert = validPayouts.map(payout => ({
          customer_id: formData.customer_id,
          amount_inr: parseFloat(payout.amount_inr),
          date: payout.date,
          notes: payout.notes
        }));

        const { error } = await supabase
          .from('payouts')
          .insert(payoutsToInsert);

        if (error) throw error;
        setMessage(`Successfully added ${validPayouts.length} payout(s)`);
      }

      setFormData({
        customer_id: '',
        payouts: [
          {
            amount_inr: '',
            date: format(new Date(), 'yyyy-MM-dd'),
            notes: ''
          }
        ]
      });
      setCustomerSearch('');
      setShowForm(false);
      setEditingPayout(null);
      fetchData();
      
      // Refresh customers list to update payout totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
    } catch (error) {
      console.error('Error saving payout:', error);
      setMessage('Error saving payout');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (payout) => {
    setEditingPayout(payout);
    setFormData({
      customer_id: payout.customer_id,
      payouts: [
        {
          amount_inr: payout.amount_inr.toString(),
          date: format(new Date(payout.date), 'yyyy-MM-dd'),
          notes: payout.notes || ''
        }
      ]
    });
    setCustomerSearch(payout.customers?.email || '');
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this payout?')) return;

    try {
      const { error } = await supabase
        .from('payouts')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setMessage('Payout deleted successfully');
      fetchData();
      
      // Refresh customers list to update payout totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
    } catch (error) {
      console.error('Error deleting payout:', error);
      setMessage('Error deleting payout');
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingPayout(null);
    setFormData({
      customer_id: '',
      payouts: [
        {
          amount_inr: '',
          date: format(new Date(), 'yyyy-MM-dd'),
          notes: ''
        }
      ]
    });
    setCustomerSearch('');
    setShowCustomerDropdown(false);
  };

  // Client-side filtering for customer dropdown
  const filteredCustomers = customers.filter(customer =>
    customer.email.toLowerCase().includes(customerSearchTerm.toLowerCase())
  );

  const handleCustomerSelect = (customer) => {
    setFormData({ ...formData, customer_id: customer.id });
    setCustomerSearch(customer.email);
    setShowCustomerDropdown(false);
  };

  const getSelectedCustomerEmail = () => {
    const customer = customers.find(c => c.id === formData.customer_id);
    return customer ? customer.email : '';
  };

  const addPayoutRow = () => {
    setFormData({
      ...formData,
      payouts: [
        ...formData.payouts,
        {
          amount_inr: '',
          date: format(new Date(), 'yyyy-MM-dd'),
          notes: ''
        }
      ]
    });
  };

  const removePayoutRow = (index) => {
    if (formData.payouts.length > 1) {
      const newPayouts = formData.payouts.filter((_, i) => i !== index);
      setFormData({
        ...formData,
        payouts: newPayouts
      });
    }
  };

  const updatePayoutRow = (index, field, value) => {
    const newPayouts = [...formData.payouts];
    newPayouts[index] = {
      ...newPayouts[index],
      [field]: value
    };
    setFormData({
      ...formData,
      payouts: newPayouts
    });

    // Live UTR validation for single payout form
    if (field === 'notes' && value.trim()) {
      validateUtrLiveSingle(value.trim(), index);
    } else if (field === 'notes' && !value.trim()) {
      // Clear validation state if UTR is empty
      setUtrValidation(prev => ({
        ...prev,
        [`single_${index}`]: { isValid: true, message: '' }
      }));
    }
  };

  // Auto-select customer if email exists
  const handleCustomerEmailChange = (e) => {
    const email = e.target.value;
    setCustomerSearch(email);
    setCustomerSearchTerm(email); // Trigger server-side search
    
    // Check if the email exists in current customers list
    const existingCustomer = customers.find(customer => 
      customer.email.toLowerCase() === email.toLowerCase()
    );
    
    if (existingCustomer) {
      // Auto-select the customer
      setFormData({ ...formData, customer_id: existingCustomer.id });
      setShowCustomerDropdown(false);
    } else {
      // Clear selection if email doesn't exist
      setFormData({ ...formData, customer_id: '' });
      setShowCustomerDropdown(true);
    }
  };

  const exportToCSV = () => {
    const exportData = payouts.map(payout => ({
      'Customer Email': payout.customers?.email || '',
      'Amount (INR)': payout.amount_inr,
      'Date': format(new Date(payout.date), 'dd/MM/yyyy'),
      'UTR': payout.utr || '',
      'Notes': payout.notes || '',
      'Created At': format(new Date(payout.created_at), 'dd/MM/yyyy HH:mm')
    }));

    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'payouts.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

     const downloadSampleCSV = () => {
     const sampleData = [
       {
         'Customer Email': 'john.doe@example.com',
         'Amount (INR)': '8000',
         'Date': '01/01/2024',
         'UTR': 'UTR123456789',
         'Notes': 'Sample payout'
       },
       {
         'Customer Email': 'jane.smith@example.com',
         'Amount (INR)': '12000',
         'Date': '02/01/2024',
         'UTR': 'UTR987654321',
         'Notes': 'Another payout'
       },
       {
         'Customer Email': 'bob.johnson@example.com',
         'Amount (INR)': '15000',
         'Date': '03/01/2024',
         'UTR': 'UTR456789123',
         'Notes': 'Third payout'
       },
       {
         'Customer Email': 'alice.wilson@example.com',
         'Amount (INR)': '10000',
         'Date': '04/01/2024',
         'UTR': '',
         'Notes': 'This entry will show an error - UTR is required'
       }
     ];

    const csv = Papa.unparse(sampleData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'sample_payouts.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

    const handleMissingEntriesSubmit = async (e) => {
    e.preventDefault();
    setMissingEntriesLoading(true);

    try {
             // Validate data
       const validRows = missingEntriesData.filter(row => 
         row.customer_email && row.amount_inr && row.amount_inr > 0 && validateDate(row.date) && row.utr && row.utr.trim()
       );

             if (validRows.length === 0) {
         setMessage('Please fix at least one valid payout row with customer, amount, and UTR');
         setMissingEntriesLoading(false);
         return;
       }

      // Get customer IDs for all emails
      const customerEmails = [...new Set(validRows.map(row => row.customer_email))];
      const { data: customerData, error: customerError } = await supabase
        .from('customers')
        .select('id, email')
        .in('email', customerEmails);

      if (customerError) throw customerError;

      const customerMap = {};
      customerData.forEach(customer => {
        customerMap[customer.email] = customer.id;
      });

      // Check for missing customers
      const missingEmails = customerEmails.filter(email => !customerMap[email]);
      if (missingEmails.length > 0) {
        setMessage(`Customers not found: ${missingEmails.join(', ')}`);
        setMissingEntriesLoading(false);
        return;
      }

      // Check for UTR duplicates
      const utrsToCheck = validRows
        .map(row => row.utr)
        .filter(utr => utr && utr.trim() !== '');

      if (utrsToCheck.length > 0) {
        const { data: existingPayments, error: paymentsCheckError } = await supabase
          .from('payments')
          .select('utr')
          .in('utr', utrsToCheck);

        if (paymentsCheckError) throw paymentsCheckError;

        const { data: existingPayouts, error: payoutsCheckError } = await supabase
          .from('payouts')
          .select('notes')
          .in('notes', utrsToCheck);

        if (payoutsCheckError) throw payoutsCheckError;

        const existingUtrs = [
          ...(existingPayments || []).map(p => p.utr),
          ...(existingPayouts || []).map(p => p.notes)
        ];

        const duplicateUtrs = utrsToCheck.filter(utr => existingUtrs.includes(utr));

        if (duplicateUtrs.length > 0) {
          setMessage(`UTR(s) already exist: ${duplicateUtrs.join(', ')}. Please use a different UTR.`);
          setMissingEntriesLoading(false);
          return;
        }
      }

      // Prepare payouts for insertion
      const payoutsToInsert = validRows.map(row => {
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
        
        return {
          customer_id: customerMap[row.customer_email],
          amount_inr: parseFloat(row.amount_inr),
          date: dbDate,
          utr: row.utr,
          notes: row.notes
        };
      });

      const { error } = await supabase
        .from('payouts')
        .insert(payoutsToInsert);

      if (error) throw error;
      setMessage(`Successfully added ${validRows.length} corrected payout(s)`);
      
      // Reset form
      setMissingEntriesData([]);
      setShowMissingEntriesTable(false);
      fetchData();
    } catch (error) {
      console.error('Error saving corrected payouts:', error);
      setMessage('Error saving corrected payouts');
    } finally {
      setMissingEntriesLoading(false);
    }
  };

  const updateMissingEntry = (index, field, value) => {
    const newData = [...missingEntriesData];
    newData[index] = {
      ...newData[index],
      [field]: value
    };
    setMissingEntriesData(newData);
  };

  const removeMissingEntry = (index) => {
    setMissingEntriesData(missingEntriesData.filter((_, i) => i !== index));
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      setMessage('Please select a valid CSV file');
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        if (results.errors.length > 0) {
          const realErrors = results.errors.filter(error => 
            !error.message.includes('Unable to auto-detect delimiting character')
          );
          
          if (realErrors.length > 0) {
            setMessage(`Error parsing CSV file: ${realErrors[0].message || 'Please check the format.'}`);
            return;
          }
        }

        // Check if the CSV has the required columns
        const requiredColumns = ['Customer Email', 'Amount (INR)', 'Date'];
        const missingColumns = requiredColumns.filter(col => !results.data[0] || !results.data[0].hasOwnProperty(col));
        
        if (missingColumns.length > 0) {
          setMessage(`CSV file is missing required columns: ${missingColumns.join(', ')}`);
          return;
        }

        // Filter rows that have required data
        const payouts = results.data.filter(row => {
          return row['Customer Email'] && 
                 row['Amount (INR)'] && 
                 row['Amount (INR)'].toString().trim() !== '' &&
                 row['Date'] && 
                 row['Date'].toString().trim() !== '';
        });
        
        if (payouts.length === 0) {
          setMessage('No valid payout data found in CSV. Please ensure the file has the required columns with data.');
          return;
        }

        setUploadLoading(true);
        try {
          // Get existing UTRs to check for duplicates (using notes field for payouts)
          const { data: existingPayouts, error: fetchError } = await supabase
            .from('payouts')
            .select('notes')
            .not('notes', 'is', null);

          if (fetchError) throw fetchError;

          const existingUTRs = new Set(existingPayouts.map(payout => payout.notes?.toLowerCase().trim()).filter(Boolean));

          // Process CSV data and identify issues
          const payoutsToInsert = [];
          const duplicates = [];
          const invalidEntries = [];
          const newlyCreatedCustomers = [];

          for (const payout of payouts) {
            const customerEmail = payout['Customer Email'].trim().toLowerCase();
            const utr = payout['UTR']?.trim() || '';
            const utrLower = utr.toLowerCase();
            const originalDate = payout['Date']?.trim() || '';
            const originalAmount = payout['Amount (INR)']?.toString() || '';

            // Check for missing UTR/Notes - this is required for payouts
            if (!utr && !payout['Notes']?.trim()) {
              invalidEntries.push({
                ...payout,
                error: 'UTR/Notes is required for payouts'
              });
              continue;
            }

            // Check for duplicate UTR
            if (utr && existingUTRs.has(utrLower)) {
              duplicates.push(utr);
              continue;
            }

            // Find customer by email
            let customer = customers.find(c => c.email.toLowerCase() === customerEmail);
            
            // If customer doesn't exist, create them automatically
            if (!customer) {
              try {
                const { data: newCustomer, error: createError } = await supabase
                  .from('customers')
                  .insert([{ email: payout['Customer Email'].trim() }])
                  .select()
                  .single();

                if (createError) {
                  // If there's an error (like duplicate email), try to fetch the existing customer
                  const { data: existingCustomer, error: fetchError } = await supabase
                    .from('customers')
                    .select('*')
                    .eq('email', payout['Customer Email'].trim())
                    .single();

                  if (fetchError || !existingCustomer) {
                    invalidEntries.push({
                      ...payout,
                      error: 'Customer not found and could not be created'
                    });
                    continue;
                  }
                  customer = existingCustomer;
                } else {
                  customer = newCustomer;
                  newlyCreatedCustomers.push(customer);
                }
              } catch (error) {
                console.error('Error creating customer:', error);
                invalidEntries.push({
                  ...payout,
                  error: 'Error creating customer'
                });
                continue;
              }
            }

            // Parse date - use auto-fix function to handle various formats
            let parsedDate;
            try {
              // Auto-fix the date format first
              const fixedDate = autoFixDateFormat(originalDate);
              
              // Convert DD/MM/YYYY to YYYY-MM-DD for database
              if (fixedDate.includes('/')) {
                const [day, month, year] = fixedDate.split('/');
                parsedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
              } else {
                parsedDate = new Date(fixedDate).toISOString().split('T')[0];
              }
            } catch (error) {
              invalidEntries.push({
                ...payout,
                error: 'Invalid date format'
              });
              continue;
            }

            // Parse amount
            const amount = parseFloat(originalAmount.replace(/[^\d.-]/g, ''));
            if (isNaN(amount) || amount <= 0) {
              invalidEntries.push({
                ...payout,
                error: 'Invalid amount'
              });
              continue;
            }

            payoutsToInsert.push({
              customer_id: customer.id,
              amount_inr: amount,
              date: parsedDate,
              notes: utr || payout['Notes']?.trim() || ''
            });

            if (utr) {
              existingUTRs.add(utrLower);
            }
          }

          // Always show the bulk editor for preview and editing
          // Add newly created customers to the customers list for the bulk editor
          if (newlyCreatedCustomers.length > 0) {
            setCustomers(prevCustomers => [...newlyCreatedCustomers, ...prevCustomers]);
          }
          
          // Prepare all entries for the bulk editor
          const allEntries = [];
          
          // Add invalid entries first (they will be at the top due to sorting)
          invalidEntries.forEach(entry => {
            const customerEmail = entry['Customer Email'].trim().toLowerCase();
            const isNewCustomer = newlyCreatedCustomers.some(c => c.email.toLowerCase() === customerEmail);
            allEntries.push({
              ...entry,
              isNewCustomer,
              newlyCreatedCustomer: isNewCustomer ? newlyCreatedCustomers.find(c => c.email.toLowerCase() === customerEmail) : null
            });
          });
          
          // Add valid entries
          payouts.forEach(payout => {
            const customerEmail = payout['Customer Email'].trim().toLowerCase();
            const isNewCustomer = newlyCreatedCustomers.some(c => c.email.toLowerCase() === customerEmail);
            
            // Auto-fix the date format for display in bulk editor
            const fixedDate = autoFixDateFormat(payout['Date']?.toString().trim() || '');
            
            allEntries.push({
              ...payout,
              'Date': fixedDate, // Use the fixed date format
              isNewCustomer,
              newlyCreatedCustomer: isNewCustomer ? newlyCreatedCustomers.find(c => c.email.toLowerCase() === customerEmail) : null
            });
          });
          
          setBulkEditorData(allEntries);
          setShowBulkEditor(true);
          setShowUploadForm(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          setUploadLoading(false);
        } catch (error) {
          console.error('Error importing payouts:', error);
          setMessage('Error importing payouts. Please try again.');
        } finally {
          setUploadLoading(false);
        }
      },
      error: (error) => {
        console.error('CSV parsing error:', error);
        setMessage('Error reading CSV file. Please check the file format.');
      }
    });
  };

  const handleSelectPayout = (payoutId) => {
    setSelectedPayouts(prev => 
      prev.includes(payoutId) 
        ? prev.filter(id => id !== payoutId)
        : [...prev, payoutId]
    );
  };

  // Bulk editor handlers
  const handleBulkEditorSave = (count) => {
    setMessage(`Successfully imported ${count} payouts from bulk editor`);
    setShowBulkEditor(false);
    setBulkEditorData([]);
    fetchData();
    
    // Refresh customers list to update payout totals
    if (window.refreshCustomersList) {
      window.refreshCustomersList();
    }
  };

  const handleBulkEditorCancel = () => {
    setShowBulkEditor(false);
    setBulkEditorData([]);
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedPayouts([]);
      setSelectAll(false);
    } else {
      setSelectedPayouts(payouts.map(payout => payout.id));
      setSelectAll(true);
    }
  };

  // Sort handler function
  const handleSort = (column) => {
    if (sortColumn === column) {
      // If clicking the same column, toggle direction
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // If clicking a different column, set it as the new sort column with default direction
      setSortColumn(column);
      setSortDirection('asc');
    }
  };





  // Function to load more payouts data
  const loadMorePayouts = async () => {
    if (isLoadingMore || !hasMoreData) return;
    
    try {
      setIsLoadingMore(true);
      
      let query = supabase
        .from('payouts')
        .select(`
          *,
          customers (email)
        `);

      // Apply search filter if search term exists (only for non-comma searches)
      if (searchTerm && searchTerm.trim() && !searchTerm.includes(',')) {
        const searchLower = searchTerm.toLowerCase();
        // Search across all fields
        query = query.or(`customers.email.ilike.%${searchLower}%`);
        query = query.or(`amount_inr::text.ilike.%${searchTerm}%`);
        query = query.or(`notes.ilike.%${searchLower}%`);
        query = query.or(`utr.ilike.%${searchLower}%`);
        query = query.or(`date::text.ilike.%${searchTerm}%`);
      }

      // Get the next batch of data (skip the ones we already have)
      const lastPayout = payouts[payouts.length - 1];
      query = query
        .order('created_at', { ascending: false })
        .lt('created_at', lastPayout.created_at)
        .limit(1000);

      const { data: morePayoutsData, error: payoutsError } = await query;

      if (payoutsError) throw payoutsError;

      if (morePayoutsData && morePayoutsData.length > 0) {
        setPayouts(prev => [...prev, ...morePayoutsData]);
        setTotalCount(prev => prev + morePayoutsData.length);
        setHasMoreData(morePayoutsData.length === 1000);
      } else {
        setHasMoreData(false);
      }
    } catch (error) {
      console.error('Error loading more data:', error);
      setMessage('Error loading more data');
    } finally {
      setIsLoadingMore(false);
    }
  };



  // Since we only load data for selected customer, no need for client-side filtering
  const getFilteredPayouts = () => {
    return payouts; // Return all payouts since they're already filtered by customer
  };

  const getPaginatedPayouts = () => {
    // Get filtered payouts and apply sorting
    const filteredPayouts = getFilteredPayouts();
    
    return filteredPayouts.sort((a, b) => {
      let aValue, bValue;
      
      switch (sortColumn) {
        case 'customer':
          aValue = (a.customers?.email || '').toLowerCase();
          bValue = (b.customers?.email || '').toLowerCase();
          break;
        case 'amount':
          aValue = parseFloat(a.amount_inr) || 0;
          bValue = parseFloat(b.amount_inr) || 0;
          break;
        case 'date':
          // Handle different date formats more robustly
          const parseDate = (dateStr) => {
            if (!dateStr) return new Date(0); // Default to epoch for invalid dates
            
            // Try parsing as-is first
            let parsed = new Date(dateStr);
            if (!isNaN(parsed.getTime())) return parsed;
            
            // Try DD/MM/YYYY format
            const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (ddmmyyyy) {
              const [, day, month, year] = ddmmyyyy;
              parsed = new Date(year, month - 1, day);
              if (!isNaN(parsed.getTime())) return parsed;
            }
            
            // Try DD-MM-YYYY format
            const ddmmyyyy2 = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
            if (ddmmyyyy2) {
              const [, day, month, year] = ddmmyyyy2;
              parsed = new Date(year, month - 1, day);
              if (!isNaN(parsed.getTime())) return parsed;
            }
            
            // Fallback to epoch for unparseable dates
            return new Date(0);
          };
          
          aValue = parseDate(a.date);
          bValue = parseDate(b.date);
          break;
        case 'utr':
          aValue = (a.utr || '').toLowerCase();
          bValue = (b.utr || '').toLowerCase();
          break;
        case 'notes':
          aValue = (a.notes || '').toLowerCase();
          bValue = (b.notes || '').toLowerCase();
          break;
        default:
          aValue = new Date(a.date);
          bValue = new Date(b.date);
      }
      
      if (aValue < bValue) {
        return sortDirection === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortDirection === 'asc' ? 1 : -1;
      }
      return 0;
    });
  };

  // Function to get total payments for a specific customer
  const getCustomerTotalPayments = (customerEmail) => {
    return payouts
      .filter(payout => payout.customers?.email === customerEmail)
      .reduce((total, payout) => total + (parseFloat(payout.amount_inr) || 0), 0);
  };

  // Function to get total deposits (payments received) for a specific customer
  const getCustomerTotalDeposits = (customerEmail) => {
    return paymentsData
      .filter(payment => payment.customers?.email === customerEmail)
      .reduce((total, payment) => total + (parseFloat(payment.amount_inr) || 0), 0);
  };

  // Function to get grouped payouts (no pagination - show all)
  const getPaginatedGroupedPayouts = () => {
    // Show all grouped payouts (no pagination)
    return getGroupedPayouts();
  };

  // Function to group payouts by customer and calculate totals
  const getGroupedPayouts = () => {
    const grouped = {};
    
    // Get filtered payouts first
    const filteredPayouts = getFilteredPayouts();
    
    // Handle case where payouts array is empty or undefined
    if (!payouts || payouts.length === 0) {
      return [];
    }
    
    filteredPayouts.forEach((payout, index) => {
      // Ensure payout has required fields
      if (!payout || !payout.amount_inr) {
        return;
      }
      
      const customerEmail = payout.customers?.email || 'Unknown';
      
      if (!grouped[customerEmail]) {
        grouped[customerEmail] = {
          customerEmail,
          totalAmount: 0,
          payoutCount: 0,
          payouts: [],
          customerId: payout.customer_id
        };
      }
      
      grouped[customerEmail].totalAmount += parseFloat(payout.amount_inr) || 0;
      grouped[customerEmail].payoutCount += 1;
      grouped[customerEmail].payouts.push(payout);
    });
    
    // Sort payouts within each group by latest creation time
    Object.values(grouped).forEach(group => {
      group.payouts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    });
    
    // Sort by latest creation time (descending) - show most recently created payouts first
    return Object.values(grouped).sort((a, b) => {
      // Get the most recent payout from each group
      const aLatest = Math.max(...a.payouts.map(p => new Date(p.created_at)));
      const bLatest = Math.max(...b.payouts.map(p => new Date(p.created_at)));
      return bLatest - aLatest;
    });
  };

    const moveToPayments = async () => {
    if (selectedPayouts.length === 0) {
      setMessage('Please select at least one payout to move');
      return;
    }

    if (!window.confirm(`Are you sure you want to move ${selectedPayouts.length} payout(s) to payments?`)) {
      return;
    }

    setLoading(true);
    try {
      // Get the selected payouts data
      const payoutsToMove = payouts.filter(payout => selectedPayouts.includes(payout.id));
      
              // Insert into payments table
        const paymentsToInsert = payoutsToMove.map(payout => ({
          customer_id: payout.customer_id,
          amount_inr: payout.amount_inr,
          date: payout.date,
          utr: payout.notes || null, // Use notes field as UTR
          notes: '' // Clear notes when moving to payments
        }));

      const { error: insertError } = await supabase
        .from('payments')
        .insert(paymentsToInsert);

      if (insertError) throw insertError;

      // Delete from payouts table
      const { error: deleteError } = await supabase
        .from('payouts')
        .delete()
        .in('id', selectedPayouts);

      if (deleteError) throw deleteError;

      setMessage(`Successfully moved ${selectedPayouts.length} payout(s) to payments`);
      setSelectedPayouts([]);
      setSelectAll(false);
      fetchData();
      
      // Refresh customers list to update totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
    } catch (error) {
      console.error('Error moving payouts:', error);
      setMessage('Error moving payouts to payments');
    } finally {
      setLoading(false);
    }
  };

  // Function to check for duplicate UTRs across both payments and payouts
  const checkDuplicateUtrs = async () => {
    try {
      console.log('=== CHECKING DUPLICATE UTRS ===');
      
      // Get all UTRs from payments table with pagination
      let allPaymentsData = [];
      let hasMorePayments = true;
      let fromPayments = 0;
      const pageSize = 1000;
      
      while (hasMorePayments) {
        console.log(`Fetching payments from ${fromPayments} to ${fromPayments + pageSize}...`);
        const { data: paymentsPage, error: paymentsError } = await supabase
          .from('payments')
          .select('utr, id, customers(email), amount_inr, date')
          .not('utr', 'is', null)
          .range(fromPayments, fromPayments + pageSize - 1);

        if (paymentsError) throw paymentsError;
        
        if (paymentsPage && paymentsPage.length > 0) {
          allPaymentsData = [...allPaymentsData, ...paymentsPage];
          fromPayments += pageSize;
          
          if (paymentsPage.length < pageSize) {
            hasMorePayments = false;
          }
        } else {
          hasMorePayments = false;
        }
      }
      
      console.log(`Total payments fetched: ${allPaymentsData.length}`);

      // Get all UTRs from payouts table (using notes field) with pagination
      let allPayoutsData = [];
      let hasMorePayouts = true;
      let fromPayouts = 0;
      
      while (hasMorePayouts) {
        console.log(`Fetching payouts from ${fromPayouts} to ${fromPayouts + pageSize}...`);
        const { data: payoutsPage, error: payoutsError } = await supabase
          .from('payouts')
          .select('notes, id, customers(email), amount_inr, date')
          .not('notes', 'is', null)
          .range(fromPayouts, fromPayouts + pageSize - 1);

        if (payoutsError) throw payoutsError;
        
        if (payoutsPage && payoutsPage.length > 0) {
          allPayoutsData = [...allPayoutsData, ...payoutsPage];
          fromPayouts += pageSize;
          
          if (payoutsPage.length < pageSize) {
            hasMorePayouts = false;
          }
        } else {
          hasMorePayouts = false;
        }
      }
      
      console.log(`Total payouts fetched: ${allPayoutsData.length}`);

      // Combine all UTRs
      const allUtrs = [
        ...allPaymentsData.map(p => ({ utr: p.utr, type: 'payment', id: p.id, customer: p.customers?.email, amount: p.amount_inr, date: p.date })),
        ...allPayoutsData.map(p => ({ utr: p.notes, type: 'payout', id: p.id, customer: p.customers?.email, amount: p.amount_inr, date: p.date }))
      ];

      // Find duplicates
      const utrCounts = {};
      const duplicateUtrs = [];

      allUtrs.forEach(item => {
        if (item.utr) {
          if (!utrCounts[item.utr]) {
            utrCounts[item.utr] = [];
          }
          utrCounts[item.utr].push(item);
        }
      });

      Object.keys(utrCounts).forEach(utr => {
        if (utrCounts[utr].length > 1) {
          duplicateUtrs.push({
            utr: utr,
            items: utrCounts[utr]
          });
        }
      });

      console.log(`Total UTRs processed: ${Object.keys(utrCounts).length}`);
      console.log(`Duplicate UTRs found: ${duplicateUtrs.length}`);
      if (duplicateUtrs.length > 0) {
        console.log('Duplicate UTRs:', duplicateUtrs.map(d => d.utr));
      }
      console.log('=== END CHECKING DUPLICATE UTRS ===');

      return duplicateUtrs;
    } catch (error) {
      console.error('Error checking duplicate UTRs:', error);
      return [];
    }
  };

  const bulkDeletePayouts = async () => {
    if (selectedPayouts.length === 0) {
      setMessage('Please select at least one payout to delete');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${selectedPayouts.length} payout(s)? This action cannot be undone.`)) {
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('payouts')
        .delete()
        .in('id', selectedPayouts);

      if (error) throw error;

      // Check for duplicate UTRs after deletion
      const duplicateUtrs = await checkDuplicateUtrs();

      let message = `Successfully deleted ${selectedPayouts.length} payout(s)`;
      
      if (duplicateUtrs.length > 0) {
        message += `. ⚠️ Found ${duplicateUtrs.length} duplicate UTR(s) remaining in the system: ${duplicateUtrs.map(d => d.utr).join(', ')}`;
      }

      setMessage(message);
      setSelectedPayouts([]);
      setSelectAll(false);
      fetchData();
      
      // Refresh customers list to update payout totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
    } catch (error) {
      console.error('Error deleting payouts:', error);
      setMessage('Error deleting payouts');
    } finally {
      setLoading(false);
    }
  };

  const bulkDeletePayoutsWithoutUtr = async () => {
    const payoutsWithoutUtr = payouts.filter(payout => !payout.notes || !payout.notes.trim());
    
    if (payoutsWithoutUtr.length === 0) {
      setMessage('No payouts found without UTR');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${payoutsWithoutUtr.length} payout(s) that are missing UTR? This action cannot be undone.`)) {
      return;
    }

    setLoading(true);
    try {
      const payoutIdsToDelete = payoutsWithoutUtr.map(payout => payout.id);
      
      const { error } = await supabase
        .from('payouts')
        .delete()
        .in('id', payoutIdsToDelete);

      if (error) throw error;

      // Check for duplicate UTRs after deletion
      const duplicateUtrs = await checkDuplicateUtrs();

      let message = `Successfully deleted ${payoutsWithoutUtr.length} payout(s) without UTR`;
      
      if (duplicateUtrs.length > 0) {
        message += `. ⚠️ Found ${duplicateUtrs.length} duplicate UTR(s) remaining in the system: ${duplicateUtrs.map(d => d.utr).join(', ')}`;
      }

      setMessage(message);
      setSelectedPayouts([]);
      setSelectAll(false);
      fetchData();
      
      // Refresh customers list to update payout totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
    } catch (error) {
      console.error('Error deleting payouts without UTR:', error);
      setMessage('Error deleting payouts without UTR');
    } finally {
      setLoading(false);
    }
  };

  const deleteDuplicateUtrs = async () => {
    if (duplicateUtrs.length === 0) return;
    
    // Calculate how many duplicates will be deleted (excluding originals)
    const totalDuplicates = duplicateUtrs.reduce((total, item) => total + (item.items.length - 1), 0);
    
    if (!window.confirm(`Are you sure you want to delete duplicate entries only? This will keep the original entry for each UTR and delete ${totalDuplicates} duplicate entries. This action cannot be undone.`)) {
      return;
    }
    
    setDeletingUtrs(true);
    
    try {
      // Get IDs to delete (excluding the first/original entry for each UTR)
      const paymentIds = [];
      const payoutIds = [];
      
      duplicateUtrs.forEach(item => {
        // Sort items by date to keep the oldest entry as original
        const sortedItems = item.items.sort((a, b) => {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          return dateA - dateB; // Keep the oldest entry
        });
        
        // Keep the first (oldest) entry, delete the rest
        const duplicatesToDelete = sortedItems.slice(1);
        
        duplicatesToDelete.forEach(entry => {
          if (entry.type === 'payment') {
            paymentIds.push(entry.id);
          } else if (entry.type === 'payout') {
            payoutIds.push(entry.id);
          }
        });
      });
      
      console.log(`Deleting ${paymentIds.length} duplicate payments and ${payoutIds.length} duplicate payouts`);
      
      // Delete payments with duplicate UTRs
      if (paymentIds.length > 0) {
        const { error: paymentsError } = await supabase
          .from('payments')
          .delete()
          .in('id', paymentIds);
        
        if (paymentsError) throw paymentsError;
      }
      
      // Delete payouts with duplicate UTRs
      if (payoutIds.length > 0) {
        const { error: payoutsError } = await supabase
          .from('payouts')
          .delete()
          .in('id', payoutIds);
        
        if (payoutsError) throw payoutsError;
      }
      
      const totalDeleted = paymentIds.length + payoutIds.length;
      setMessage(`Successfully deleted ${totalDeleted} duplicate entries. Original entries have been preserved.`);
      setDuplicateUtrs([]);
      setShowDuplicateUtrs(false);
      
      // Refresh data
      fetchData();
      
      // Refresh customers list to update totals
      if (window.refreshCustomersList) {
        window.refreshCustomersList();
      }
      
    } catch (error) {
      console.error('Error deleting duplicate UTRs:', error);
      setMessage('Error deleting duplicate UTRs');
    } finally {
      setDeletingUtrs(false);
    }
  };



  if (loading) {
    return (
      <div className="card">
        <h2>Loading...</h2>
        <p>Please wait while we load the customer data.</p>
      </div>
    );
  }

  const validExcelRows = excelTableData.filter(isExcelRowValid);
  // The customer in the row being edited drives the Bank Search ("rajesh.kumar@x.com" -> "rajesh kumar")
  const bankFocusRow = excelTableData.find(r => r.id === bankFocusRowId) || excelTableData[excelTableData.length - 1];
  const bankAutoQuery = bankFocusRow && bankFocusRow.customer_email.trim().length >= 3 ? nameFromEmail(bankFocusRow.customer_email) : '';
  const validExcelTotal = validExcelRows.reduce((sum, row) => sum + parseFloat(row.amount_inr), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>Payouts (Outflows)</h2>
        <div>
          <button onClick={() => setShowExcelTable(true)} className="btn btn-primary">
            Add Multiple Payouts
          </button>
          <button onClick={() => setShowForm(true)} className="btn btn-secondary" style={{ marginLeft: '0.5rem' }}>
            Add Single Payout
          </button>
          <button onClick={() => setShowUploadForm(true)} className="btn btn-success" style={{ marginLeft: '0.5rem' }}>
            Upload CSV
          </button>
          <button onClick={exportToCSV} className="btn btn-secondary" style={{ marginLeft: '0.5rem' }}>
            Export CSV
          </button>
          <button onClick={fetchData} className="btn btn-warning" style={{ marginLeft: '0.5rem' }} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh Data'}
          </button>
          <button 
            onClick={() => window.debugPayoutsForCustomer && window.debugPayoutsForCustomer()} 
            className="btn btn-info" 
            style={{ marginLeft: '0.5rem' }}
            title="Debug payouts for specific customer"
          >
            Debug Payouts
          </button>
                     <button 
             onClick={async () => {
               setLoading(true);
               const duplicates = await checkDuplicateUtrs();
               if (duplicates.length > 0) {
                 setDuplicateUtrs(duplicates);
                 setShowDuplicateUtrs(true);
                 setMessage(`⚠️ Found ${duplicates.length} duplicate UTR(s). Review and delete if needed.`);
               } else {
                 setMessage('✅ No duplicate UTRs found in the system');
                 setShowDuplicateUtrs(false);
                 setDuplicateUtrs([]);
               }
               setLoading(false);
             }} 
             className="btn btn-warning" 
             style={{ marginLeft: '0.5rem' }}
             disabled={loading}
           >
             {loading ? 'Checking...' : 'Check Duplicate UTRs'}
           </button>
           <button 
             onClick={bulkDeletePayoutsWithoutUtr} 
             className="btn btn-danger" 
             style={{ marginLeft: '0.5rem' }}
             disabled={loading}
           >
             {loading ? 'Deleting...' : `Delete All Without UTR (${payouts.filter(payout => !payout.notes || !payout.notes.trim()).length})`}
           </button>
        </div>
      </div>


      {/* View Mode Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button 
            onClick={() => setViewMode('list')} 
            className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
          >
            📋 List View
          </button>
          <button 
            onClick={() => setViewMode('grouped')} 
            className={`btn ${viewMode === 'grouped' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
          >
            📊 Grouped by Customer
          </button>

        </div>
        <div style={{ fontSize: '0.9rem', color: '#666' }}>
          {!selectedCustomerForFilter ? (
            <span style={{ color: '#6c757d' }}>Select a customer to view their payouts</span>
          ) : (
            <>
              {viewMode === 'list' ? `${getFilteredPayouts().length} payout(s) for ${selectedCustomerForFilter.email}` : `${getGroupedPayouts().length} customer(s)`}
              <span style={{ marginLeft: '0.5rem', color: '#28a745', fontWeight: 'bold' }}>
                • All payouts loaded
              </span>
            </>
          )}
        </div>
      </div>

             {/* Bulk Actions */}
       {selectedPayouts.length > 0 && (
         <div className="card" style={{ marginBottom: '1rem', backgroundColor: '#f8f9fa', border: '2px solid #dc3545' }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <div>
               <strong>{selectedPayouts.length} payout(s) selected</strong>
             </div>
             <div>
               <button 
                 onClick={bulkDeletePayouts} 
                 className="btn btn-danger" 
                 disabled={loading}
                 style={{ marginRight: '0.5rem' }}
               >
                 {loading ? 'Deleting...' : `Delete Selected (${selectedPayouts.length})`}
               </button>
               <button 
                 onClick={moveToPayments} 
                 className="btn btn-success" 
                 disabled={loading}
                 style={{ marginRight: '0.5rem' }}
               >
                 {loading ? 'Moving...' : `Move to Payments (${selectedPayouts.length})`}
               </button>
               <button 
                 onClick={() => {
                   setSelectedPayouts([]);
                   setSelectAll(false);
                 }} 
                 className="btn btn-secondary"
               >
                 Clear Selection
               </button>
             </div>
           </div>
         </div>
       )}

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {/* Duplicate UTRs Section */}
      {showDuplicateUtrs && duplicateUtrs.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', border: '2px solid #f59e0b', backgroundColor: '#fef3c7' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#92400e' }}>
                ⚠️ Duplicate UTRs Found ({duplicateUtrs.length})
              </h3>
              <div style={{ fontSize: '0.9rem', color: '#92400e', marginTop: '0.25rem' }}>
                The following UTRs have multiple entries. You can delete duplicate entries only (keeping the original) to clean up the system.
              </div>
            </div>
            <div>
              <button 
                onClick={deleteDuplicateUtrs}
                className="btn btn-danger"
                disabled={deletingUtrs}
                style={{ marginRight: '0.5rem' }}
              >
                {deletingUtrs ? 'Deleting...' : `Delete Duplicates Only (${duplicateUtrs.reduce((total, item) => total + (item.items.length - 1), 0)} entries)`}
              </button>
              <button 
                onClick={() => {
                  setShowDuplicateUtrs(false);
                  setDuplicateUtrs([]);
                }} 
                className="btn btn-secondary"
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.9rem' }}
              >
                × Close
              </button>
            </div>
          </div>
          
          <div style={{ overflowX: 'auto' }}>
            <table style={{ 
              width: '100%', 
              borderCollapse: 'collapse', 
              border: '1px solid #ddd',
              fontSize: '0.9rem'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#fef3c7' }}>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>UTR</th>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>Type</th>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>Customer</th>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>Amount</th>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>Date</th>
                  <th style={{ padding: '0.75rem', border: '1px solid #ddd', textAlign: 'left' }}>ID</th>
                </tr>
              </thead>
              <tbody>
                {duplicateUtrs.map((item, index) => {
                  // Sort items by date to identify the original (oldest)
                  const sortedItems = item.items.sort((a, b) => {
                    const dateA = new Date(a.date);
                    const dateB = new Date(b.date);
                    return dateA - dateB;
                  });
                  
                  return (
                    <React.Fragment key={index}>
                      {sortedItems.map((entry, entryIndex) => (
                        <tr key={`${index}-${entryIndex}`} style={{ 
                          backgroundColor: entryIndex === 0 ? '#d4edda' : (entryIndex % 2 === 0 ? '#fff' : '#f8f9fa'),
                          border: entryIndex === 0 ? '2px solid #28a745' : '1px solid #ddd'
                        }}>
                          <td style={{ padding: '0.75rem', border: '1px solid #ddd', fontWeight: 'bold' }}>
                            {entry.utr}
                            {entryIndex === 0 && (
                              <span style={{ 
                                marginLeft: '0.5rem', 
                                backgroundColor: '#28a745', 
                                color: 'white', 
                                padding: '0.2rem 0.4rem', 
                                borderRadius: '4px', 
                                fontSize: '0.7rem',
                                fontWeight: 'bold'
                              }}>
                                ORIGINAL
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.75rem', border: '1px solid #ddd' }}>
                            <span style={{
                              backgroundColor: entry.type === 'payment' ? '#10B981' : '#F59E0B',
                              color: 'white',
                              padding: '0.25rem 0.5rem',
                              borderRadius: '4px',
                              fontSize: '0.8rem',
                              fontWeight: 'bold'
                            }}>
                              {entry.type === 'payment' ? 'Payment' : 'Payout'}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem', border: '1px solid #ddd' }}>{entry.customer || '-'}</td>
                          <td style={{ padding: '0.75rem', border: '1px solid #ddd' }}>₹{entry.amount?.toLocaleString() || '-'}</td>
                          <td style={{ padding: '0.75rem', border: '1px solid #ddd' }}>{entry.date ? format(new Date(entry.date), 'dd/MM/yyyy') : '-'}</td>
                          <td style={{ padding: '0.75rem', border: '1px solid #ddd', fontSize: '0.8rem', color: '#666' }}>{entry.id}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#fff3cd', border: '1px solid #ffeaa7', borderRadius: '4px' }}>
            <strong>⚠️ Warning:</strong> Clicking "Delete Duplicates Only" will keep the original entry (oldest by date) for each UTR and delete only the duplicate entries. 
            This action cannot be undone. {duplicateUtrs.reduce((total, item) => total + (item.items.length - 1), 0)} duplicate entries will be deleted.
          </div>
        </div>
      )}

      {/* Add Multiple Payouts table */}
      {showExcelTable && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Add Multiple Payouts</h3>
              <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                Type or paste a customer email to select it. "+ Add Row" copies the customer and date from the row above.
                Tick <strong>Payunie</strong> to allow a UTR that is already used.
                <br />
                <strong>Paste from bank statement:</strong> paste a transaction (date, narration, amount) into the Amount, Date or UTR
                cell and the row fills itself. Paste several transactions to fill several rows.
              </div>
            </div>
            <button type="button" onClick={closeExcelTable} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.9rem' }}>
              × Close
            </button>
          </div>

          <div style={{ marginBottom: '1rem', padding: '0.75rem', border: '1px solid #cfe2ff', backgroundColor: '#f8fbff', borderRadius: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showBankSearch ? '0.5rem' : 0 }}>
              <strong style={{ fontSize: '0.95rem' }}>🏦 Bank Search</strong>
              <button type="button" className="btn btn-secondary" style={{ padding: '0.15rem 0.5rem', fontSize: '0.8rem' }} onClick={() => setShowBankSearch(s => !s)}>
                {showBankSearch ? 'Hide' : 'Show'}
              </button>
            </div>
            {showBankSearch && (
              <BankSearchPanel
                compact
                autoQuery={bankAutoQuery}
                autoQueryLabel={bankFocusRow && bankFocusRow.customer_email ? `row ${excelTableData.indexOf(bankFocusRow) + 1} customer` : ''}
                formRows={excelTableData}
                onEditRecorded={handleEditRecordedFromBank}
                onPick={handleBankPick}
              />
            )}
          </div>

          <form onSubmit={handleExcelSubmit}>
            <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #ddd', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8f9fa' }}>
                    <th style={{ ...excelHeaderStyle, width: '40px', textAlign: 'center' }}>#</th>
                    <th style={{ ...excelHeaderStyle, minWidth: '220px' }}>Customer Email *</th>
                    <th style={{ ...excelHeaderStyle, minWidth: '120px' }}>Amount (INR) *</th>
                    <th style={{ ...excelHeaderStyle, minWidth: '130px' }}>Date *</th>
                    <th style={{ ...excelHeaderStyle, minWidth: '180px' }}>UTR *</th>
                    <th style={{ ...excelHeaderStyle, width: '80px', textAlign: 'center' }}>Payunie</th>
                    <th style={{ ...excelHeaderStyle, width: '50px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {excelTableData.map((row, index) => {
                    const customerMatched = customers.some(c => c.email.toLowerCase() === row.customer_email.toLowerCase());
                    const dateInvalid = row.date && !validateDate(row.date);
                    const utrStatus = row.utr ? utrValidation[`excel_${row.id}`] : null;
                    const utrTaken = utrStatus && !utrStatus.isValid;
                    let utrColor = '#28a745';
                    if (utrTaken) utrColor = row.payunie ? '#b8860b' : '#dc3545';

                    return (
                      <tr
                        key={row.id}
                        onPaste={(e) => handleExcelRowPaste(e, index)}
                        onFocus={() => setBankFocusRowId(row.id)}
                        style={{
                          backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9f9f9',
                          boxShadow: row.id === bankFocusRowId && showBankSearch ? 'inset 3px 0 0 #0d6efd' : 'none'
                        }}
                      >
                        <td style={{ ...excelCellStyle, textAlign: 'center', color: '#888' }}>{index + 1}</td>
                        <td style={excelCellStyle}>
                          <div style={{ position: 'relative' }} className="row-customer-dropdown">
                            <input
                              type="text"
                              placeholder="Search customer email..."
                              value={row.customer_email}
                              onChange={(e) => updateExcelRow(index, 'customer_email', e.target.value)}
                              onFocus={() => !customerMatched && setOpenExcelDropdownId(row.id)}
                              style={{
                                ...excelInputStyle,
                                paddingRight: '1.5rem',
                                borderColor: customerMatched ? '#28a745' : '#ccc'
                              }}
                              required
                            />
                            {customerMatched && (
                              <span style={{ position: 'absolute', top: '0.45rem', right: '0.5rem', color: '#28a745', pointerEvents: 'none' }}>✓</span>
                            )}
                            {openExcelDropdownId === row.id && row.customer_email && !customerMatched && (
                              <div style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                backgroundColor: 'white',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                maxHeight: '200px',
                                overflowY: 'auto',
                                zIndex: 9999,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                              }}>
                                {getFilteredExcelCustomers(row.customer_email).length > 0 ? (
                                  getFilteredExcelCustomers(row.customer_email).map((customer) => (
                                    <div
                                      key={customer.id}
                                      onClick={() => handleExcelCustomerSelect(customer, index)}
                                      style={{ padding: '0.5rem', cursor: 'pointer', borderBottom: '1px solid #eee' }}
                                      onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                                      onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                                    >
                                      {customer.email}
                                    </div>
                                  ))
                                ) : (
                                  <div style={{ padding: '0.5rem', color: '#666' }}>No customers found</div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={excelCellStyle}>
                          <input
                            type="number"
                            name="amount_inr"
                            value={row.amount_inr}
                            onChange={(e) => updateExcelRow(index, 'amount_inr', e.target.value)}
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            style={excelInputStyle}
                            required
                          />
                        </td>
                        <td style={excelCellStyle}>
                          <input
                            type="text"
                            name="date"
                            value={row.date}
                            onChange={(e) => updateExcelRow(index, 'date', e.target.value)}
                            onBlur={() => normalizeExcelDate(index)}
                            placeholder="DD/MM/YYYY"
                            title="DD/MM/YYYY, 09 Jan 23 or 01-Mar-2023 (years 2022-2023)"
                            style={{
                              ...excelInputStyle,
                              borderColor: dateInvalid ? '#dc3545' : '#ccc',
                              backgroundColor: dateInvalid ? '#fff5f5' : 'white'
                            }}
                            required
                          />
                          {dateInvalid && (
                            <div style={{ fontSize: '0.75rem', color: '#dc3545', marginTop: '0.25rem' }}>
                              Use DD/MM/YYYY (2022-2023)
                            </div>
                          )}
                        </td>
                        <td style={excelCellStyle}>
                          <input
                            type="text"
                            name="utr"
                            value={row.utr}
                            onChange={(e) => updateExcelRow(index, 'utr', e.target.value)}
                            placeholder="UTR123456789"
                            style={{
                              ...excelInputStyle,
                              borderColor: utrStatus ? utrColor : '#ccc',
                              backgroundColor: utrTaken && !row.payunie ? '#fff5f5' : 'white'
                            }}
                            required
                          />
                          {utrTaken && (
                            <div style={{ fontSize: '0.75rem', color: utrColor, marginTop: '0.25rem' }}>
                              {row.payunie ? 'Already used - allowed (Payunie)' : utrStatus.message}
                            </div>
                          )}
                        </td>
                        <td style={{ ...excelCellStyle, textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={row.payunie}
                            onChange={(e) => updateExcelRow(index, 'payunie', e.target.checked)}
                            title="Payunie: allow this UTR even if it is already used"
                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ ...excelCellStyle, textAlign: 'center' }}>
                          {excelTableData.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeExcelRow(row.id)}
                              title="Remove this row"
                              style={{
                                background: 'none',
                                color: '#dc3545',
                                border: '1px solid #dc3545',
                                borderRadius: '50%',
                                width: '24px',
                                height: '24px',
                                fontSize: '14px',
                                lineHeight: 1,
                                cursor: 'pointer'
                              }}
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={addExcelRow} className="btn btn-success" style={{ padding: '0.5rem 1rem' }}>
                + Add Row
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontSize: '0.9rem', color: '#666' }}>
                  {validExcelRows.length} of {excelTableData.length} row(s) ready · Total ₹{validExcelTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading || validExcelRows.length === 0}
                  style={{ padding: '0.6rem 1.5rem' }}
                >
                  {loading ? 'Saving...' : `Save ${validExcelRows.length} Payout(s)`}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

       {/* Missing Entries Table */}
       {showMissingEntriesTable && (
         <div className="card" style={{ marginBottom: '1rem', border: '2px solid #ffc107' }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
             <div>
               <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#856404' }}>⚠️ Fix Missing/Invalid Entries</h3>
               <div style={{ fontSize: '0.8rem', color: '#856404', marginTop: '0.25rem' }}>
                 Please fix the errors below and save the corrected entries
               </div>
             </div>
             <button 
               onClick={() => {
                 setShowMissingEntriesTable(false);
                 setMissingEntriesData([]);
               }} 
               className="btn btn-secondary"
               style={{ padding: '0.25rem 0.5rem', fontSize: '0.9rem' }}
             >
               × Close
             </button>
           </div>
           
           <form onSubmit={handleMissingEntriesSubmit}>
             <div style={{ marginBottom: '1rem', position: 'relative' }}>
               <div style={{ overflowX: 'auto' }}>
                 <table style={{ 
                   width: '100%', 
                   borderCollapse: 'collapse', 
                   border: '1px solid #ddd',
                   fontSize: '0.9rem'
                 }}>
                   <thead>
                     <tr style={{ backgroundColor: '#fff3cd' }}>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'left',
                         minWidth: '200px'
                       }}>
                         Customer Email *
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'left',
                         minWidth: '150px'
                       }}>
                         Amount (INR) *
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'left',
                         minWidth: '120px'
                       }}>
                         Date (DD/MM/YYYY) *
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'left',
                         minWidth: '150px'
                       }}>
                         UTR Number *
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'left',
                         minWidth: '150px'
                       }}>
                         Notes
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'center',
                         minWidth: '100px'
                       }}>
                         Error
                       </th>
                       <th style={{ 
                         padding: '0.75rem', 
                         border: '1px solid #ddd', 
                         textAlign: 'center',
                         width: '60px'
                       }}>
                         Action
                       </th>
                     </tr>
                   </thead>
                   <tbody>
                     {missingEntriesData.map((row, index) => (
                       <tr key={index} style={{ 
                         backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9f9f9',
                         borderBottom: '1px solid #eee'
                       }}>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                           <input
                             type="text"
                             value={row.customer_email}
                             onChange={(e) => updateMissingEntry(index, 'customer_email', e.target.value)}
                             placeholder="customer@example.com"
                             style={{
                               width: '100%',
                               padding: '0.5rem',
                               border: '1px solid #ccc',
                               borderRadius: '4px',
                               fontSize: '0.9rem'
                             }}
                             required
                           />
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                           <input
                             type="number"
                             value={row.amount_inr}
                             onChange={(e) => updateMissingEntry(index, 'amount_inr', e.target.value)}
                             step="0.01"
                             min="0"
                             placeholder="0.00"
                             style={{
                               width: '100%',
                               padding: '0.5rem',
                               border: '1px solid #ccc',
                               borderRadius: '4px',
                               fontSize: '0.9rem'
                             }}
                             required
                           />
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                           <input
                             type="text"
                             value={row.date}
                             onChange={(e) => updateMissingEntry(index, 'date', e.target.value)}
                             placeholder="DD/MM/YYYY or DD-MMM-YY"
                             style={{
                               width: '100%',
                               padding: '0.5rem',
                               border: row.date && !validateDate(row.date) ? '1px solid #dc3545' : '1px solid #ccc',
                               borderRadius: '4px',
                               fontSize: '0.9rem',
                               backgroundColor: row.date && !validateDate(row.date) ? '#fff5f5' : 'white'
                             }}
                             required
                           />
                           {row.date && !validateDate(row.date) && (
                             <div style={{ 
                               fontSize: '0.75rem', 
                               color: '#dc3545', 
                               marginTop: '0.25rem' 
                             }}>
                               Please enter a valid date in DD/MM/YYYY or DD-MMM-YY format
                             </div>
                           )}
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                           <input
                             type="text"
                             value={row.utr}
                             onChange={(e) => updateMissingEntry(index, 'utr', e.target.value)}
                             placeholder="UTR123456789"
                             style={{
                               width: '100%',
                               padding: '0.5rem',
                               border: '1px solid #ccc',
                               borderRadius: '4px',
                               fontSize: '0.9rem'
                             }}
                           />
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd' }}>
                           <input
                             type="text"
                             value={row.notes}
                             onChange={(e) => updateMissingEntry(index, 'notes', e.target.value)}
                             placeholder="Notes"
                             style={{
                               width: '100%',
                               padding: '0.5rem',
                               border: '1px solid #ccc',
                               borderRadius: '4px',
                               fontSize: '0.9rem'
                             }}
                           />
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd', textAlign: 'center' }}>
                           <span style={{ 
                             fontSize: '0.75rem', 
                             color: '#dc3545',
                             fontWeight: 'bold'
                           }}>
                             {row.error}
                           </span>
                         </td>
                         <td style={{ padding: '0.5rem', border: '1px solid #ddd', textAlign: 'center' }}>
                           <button
                             type="button"
                             onClick={() => removeMissingEntry(index)}
                             style={{
                               background: '#dc3545',
                               color: 'white',
                               border: 'none',
                               borderRadius: '50%',
                               width: '24px',
                               height: '24px',
                               fontSize: '14px',
                               cursor: 'pointer',
                               display: 'flex',
                               alignItems: 'center',
                               justifyContent: 'center'
                             }}
                             title="Remove this row"
                           >
                             ×
                           </button>
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
             </div>
             
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
               <div style={{ fontSize: '0.9rem', color: '#856404' }}>
                 {missingEntriesData.filter(row => row.customer_email && row.amount_inr && row.amount_inr > 0 && validateDate(row.date) && row.utr && row.utr.trim()).length} valid row(s) ready to save
               </div>
             </div>
             
             <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button 
                   type="submit" 
                   className="btn btn-warning" 
                   disabled={missingEntriesLoading}
                   style={{ padding: '0.75rem 1.5rem', fontSize: '1rem' }}
                 >
                   {missingEntriesLoading ? 'Saving...' : `Save ${missingEntriesData.filter(row => row.customer_email && row.amount_inr && row.amount_inr > 0 && validateDate(row.date) && row.utr && row.utr.trim()).length} Corrected Payout(s)`}
                 </button>
               <button 
                 type="button" 
                 onClick={() => {
                   setShowMissingEntriesTable(false);
                   setMissingEntriesData([]);
                 }} 
                 className="btn btn-secondary"
                 style={{ padding: '0.75rem 1.5rem', fontSize: '1rem' }}
               >
                 Cancel
               </button>
             </div>
           </form>
         </div>
       )}

       {showForm && (
        <div id="payout-edit-form" className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem' }}>{editingPayout ? 'Edit Payout' : 'Add New Payout'}</h3>
          <div style={{ fontSize: '0.8rem', color: '#856404', backgroundColor: '#fff3cd', padding: '0.5rem', borderRadius: '4px', marginBottom: '1rem' }}>
            <strong>Note:</strong> UTR is required for all payouts. Please provide a unique UTR number for each payout.
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
            <div className="form-group" style={{ marginBottom: '0' }}>
              <label htmlFor="customer_search" style={{ fontSize: '0.9rem', marginBottom: '0.25rem' }}>Customer *</label>
              <div style={{ position: 'relative' }} className="customer-dropdown-container">
                                 <input
                   type="text"
                   id="customer_search"
                   placeholder="Search for customer..."
                   value={customerSearch}
                   onChange={handleCustomerEmailChange}
                   onFocus={() => setShowCustomerDropdown(true)}
                   style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}
                   required={!formData.customer_id}
                 />
                {showCustomerDropdown && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    backgroundColor: 'white',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    zIndex: 1000,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                  }}>
                    {/* Customer Search Input */}
                    <div style={{ padding: '0.5rem', borderBottom: '1px solid #eee' }}>
                      <input
                        type="text"
                        placeholder="Search customers..."
                        value={customerSearchTerm}
                        onChange={(e) => {
                          setCustomerSearchTerm(e.target.value);
                        }}
                        style={{
                          width: '100%',
                          padding: '0.25rem',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '0.9rem'
                        }}
                      />
                    </div>
                    
                                        {/* Customer List */}
                    {filteredCustomers.length > 0 ? (
                      <>
                        {filteredCustomers.map((customer) => (
                          <div
                            key={customer.id}
                            onClick={() => handleCustomerSelect(customer)}
                            style={{
                              padding: '0.5rem',
                              cursor: 'pointer',
                              borderBottom: '1px solid #eee',
                              fontSize: '0.9rem'
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                          >
                            {customer.email}
                          </div>
                        ))}
                      </>
                    ) : (
                      <div style={{ padding: '0.5rem', color: '#666', fontSize: '0.9rem' }}>
                        {customerSearchTerm ? 'No customers found matching your search' : 'No customers available'}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {formData.customer_id && (
                <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                  Selected: {getSelectedCustomerEmail()}
                </div>
              )}
            </div>
            
                                      <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>Payout Details</label>
                </div>
               
               {formData.payouts.map((payout, index) => (
                 <div key={index} style={{ 
                   border: '1px solid #ddd', 
                   borderRadius: '8px', 
                   padding: '1rem', 
                   marginBottom: '0.75rem',
                   backgroundColor: '#f9f9f9'
                 }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                     <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#666' }}>
                       Payout {index + 1}
                     </span>
                     {!editingPayout && formData.payouts.length > 1 && (
                       <button
                         type="button"
                         onClick={() => removePayoutRow(index)}
                         style={{
                           background: '#dc3545',
                           color: 'white',
                           border: 'none',
                           borderRadius: '50%',
                           width: '24px',
                           height: '24px',
                           fontSize: '14px',
                           cursor: 'pointer',
                           display: 'flex',
                           alignItems: 'center',
                           justifyContent: 'center'
                         }}
                         title="Remove this payout"
                       >
                         ×
                       </button>
                     )}
                   </div>
                   
                                       <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                      <div className="form-group" style={{ marginBottom: '0' }}>
                        <label style={{ fontSize: '0.8rem', marginBottom: '0.25rem', display: 'block' }}>Amount (INR) *</label>
                        <input
                          type="number"
                          value={payout.amount_inr}
                          onChange={(e) => updatePayoutRow(index, 'amount_inr', e.target.value)}
                          step="0.01"
                          min="0"
                          required
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                          placeholder="0.00"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: '0' }}>
                        <label style={{ fontSize: '0.8rem', marginBottom: '0.25rem', display: 'block' }}>Date *</label>
                        <input
                          type="date"
                          value={payout.date}
                          onChange={(e) => updatePayoutRow(index, 'date', e.target.value)}
                          required
                          style={{ width: '100%', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px', fontSize: '0.9rem' }}
                        />
                      </div>
                    </div>
                    
                                         <div className="form-group" style={{ marginBottom: '0' }}>
                                               <label style={{ fontSize: '0.8rem', marginBottom: '0.25rem', display: 'block' }}>UTR Number *</label>
                       <input
                         type="text"
                         value={payout.notes}
                         onChange={(e) => updatePayoutRow(index, 'notes', e.target.value)}
                         style={{ 
                           width: '100%', 
                           padding: '0.5rem', 
                           border: payout.notes && utrValidation[`single_${index}`] ? 
                             (utrValidation[`single_${index}`].isValid ? '1px solid #28a745' : '1px solid #dc3545') : 
                             (!payout.notes || !payout.notes.trim() ? '1px solid #dc3545' : '1px solid #ddd'), 
                           borderRadius: '4px', 
                           fontSize: '0.9rem',
                           backgroundColor: (payout.notes && utrValidation[`single_${index}`] && !utrValidation[`single_${index}`].isValid) || (!payout.notes || !payout.notes.trim()) ? '#fff5f5' : 'white'
                         }}
                         placeholder="UTR123456789"
                         required
                       />
                       {payout.notes && utrValidation[`single_${index}`] && (
                         <div style={{ 
                           fontSize: '0.75rem', 
                           color: utrValidation[`single_${index}`].isValid ? '#28a745' : '#dc3545', 
                           marginTop: '0.25rem' 
                         }}>
                           {utrValidation[`single_${index}`].message}
                         </div>
                       )}
                       {(!payout.notes || !payout.notes.trim()) && (
                         <div style={{ 
                           fontSize: '0.75rem', 
                           color: '#dc3545', 
                           marginTop: '0.25rem' 
                         }}>
                           UTR is required for payouts
                         </div>
                       )}
                     </div>
                 </div>
                               ))}
              </div>
             
             {/* Add Payout Row Button */}
             {!editingPayout && (
               <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                 <button
                   type="button"
                   onClick={addPayoutRow}
                   style={{
                     background: '#28a745',
                     color: 'white',
                     border: 'none',
                     borderRadius: '50%',
                     width: '40px',
                     height: '40px',
                     fontSize: '20px',
                     cursor: 'pointer',
                     display: 'flex',
                     alignItems: 'center',
                     justifyContent: 'center',
                     boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                   }}
                   title="Add another payout"
                 >
                   +
                 </button>
               </div>
             )}
             
             <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
               <button type="submit" className="btn btn-success" disabled={loading} style={{ flex: 1, padding: '0.5rem' }}>
                 {loading ? 'Saving...' : (editingPayout ? 'Update' : 'Save')}
               </button>
               <button type="button" onClick={handleCancel} className="btn btn-secondary" style={{ padding: '0.5rem' }}>
                 Cancel
               </button>
             </div>
          </form>
        </div>
      )}

      {showUploadForm && (
        <div className="card">
          <h3>Upload Payouts from CSV</h3>
                     <div style={{ marginBottom: '1rem' }}>
             <p><strong>CSV Format Requirements:</strong></p>
             <ul style={{ marginLeft: '1rem', marginBottom: '1rem' }}>
               <li>First row should contain headers: "Customer Email", "Amount (INR)", "Date", "UTR" (required), "Notes" (optional)</li>
               <li>Customer Email must exist in the system (will be created automatically if not found)</li>
               <li>Date format: DD/MM/YYYY (e.g., 01/01/2024)</li>
               <li>Amount should be a positive number</li>
               <li><strong>UTR is REQUIRED for payouts</strong> - entries without UTR will be shown for editing</li>
               <li>UTR must be unique if provided</li>
               <li>Duplicate UTRs will be automatically skipped</li>
             </ul>
            <button onClick={downloadSampleCSV} className="btn btn-secondary btn-sm">
              Download Sample CSV
            </button>
          </div>
          <form>
            <div className="form-group">
              <label htmlFor="csvFile">Select CSV File</label>
              <input
                type="file"
                id="csvFile"
                accept=".csv"
                ref={fileInputRef}
                onChange={handleFileUpload}
                disabled={uploadLoading}
              />
            </div>
            <div>
              <button 
                type="button" 
                onClick={() => setShowUploadForm(false)} 
                className="btn btn-secondary"
                disabled={uploadLoading}
              >
                Cancel
              </button>
            </div>
          </form>
          {uploadLoading && (
            <div style={{ marginTop: '1rem' }}>
              <p>Uploading payouts...</p>
            </div>
          )}
        </div>
      )}

      {/* Search Box */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ flex: 1 }}>
            <div style={{ position: 'relative' }} className="customer-search-dropdown-container">
              <input
                type="text"
                placeholder="Search and select customers (comma-separated for multiple)..."
                value={customerSearchInput}
                onChange={(e) => {
                  const value = e.target.value;
                  setCustomerSearchInput(value);
                  
                  // Handle breadcrumb-style selection
                  if (value.includes(',')) {
                    const parts = value.split(',');
                    const lastPart = parts[parts.length - 1].trim();
                    setCurrentSearchTerm(lastPart);
                    
                    // Find customers for the current search term
                    if (lastPart.length > 0) {
                      findMatchingCustomersForCurrentTerm(lastPart);
                      setShowCustomerSearchDropdown(true);
                    } else {
                      setMatchingCustomers([]);
                      setShowCustomerSearchDropdown(false);
                    }
                  } else {
                    // No comma - regular search
                    setCurrentSearchTerm(value);
                    findMatchingCustomersForCurrentTerm(value);
                    setShowCustomerSearchDropdown(value.length > 0);
                  }
                }}
                onFocus={() => setShowCustomerSearchDropdown(true)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid #ddd',
                  fontSize: '1rem'
                }}
              />
              
              {/* Customer Dropdown */}
              {showCustomerSearchDropdown && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  backgroundColor: 'white',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  maxHeight: '300px',
                  overflowY: 'auto',
                  zIndex: 1000,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                  marginTop: '2px'
                }}>
                  {currentSearchTerm && (
                    <div style={{
                      padding: '0.5rem',
                      backgroundColor: '#f5f5f5',
                      borderBottom: '1px solid #ddd',
                      fontWeight: 'bold',
                      fontSize: '0.9rem'
                    }}>
                      Search results for "{currentSearchTerm}" ({matchingCustomers.length} found)
                    </div>
                  )}
                  
                  {(currentSearchTerm ? matchingCustomers : getFilteredCustomersForSearch()).map((customer) => {
                    const isSelected = selectedCustomersForFilter.find(c => c.id === customer.id);
                    return (
                      <div
                        key={customer.id}
                        onClick={() => handleCustomerSelectForFilter(customer)}
                        style={{
                          padding: '0.75rem',
                          cursor: 'pointer',
                          borderBottom: '1px solid #eee',
                          fontSize: '0.9rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          backgroundColor: isSelected ? '#e3f2fd' : 'white'
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) {
                            e.target.style.backgroundColor = '#f5f5f5';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) {
                            e.target.style.backgroundColor = 'white';
                          }
                        }}
                      >
                        <span>{customer.email}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {isSelected && (
                            <span style={{ color: '#1976d2', fontSize: '0.8rem' }}>✓ Selected</span>
                          )}
                          <span style={{ fontSize: '0.8rem', color: '#666' }}>
                            {customer.id}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  
                  {currentSearchTerm && matchingCustomers.length === 0 && (
                    <div style={{ padding: '0.75rem', color: '#666', fontSize: '0.9rem' }}>
                      No customers found for "{currentSearchTerm}"
                    </div>
                  )}
                  
                  {!currentSearchTerm && getFilteredCustomersForSearch().length === 0 && (
                    <div style={{ padding: '0.75rem', color: '#666', fontSize: '0.9rem' }}>
                      No customers found
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Clear Filter Button */}
          {selectedCustomerForFilter && (
            <button
              onClick={clearCustomerFilter}
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.9rem',
                whiteSpace: 'nowrap'
              }}
              title="Clear customer filter and show all payouts"
            >
              Clear Filter
            </button>
          )}
        </div>
        
        {/* Selected Customers Breadcrumb Display */}
        {selectedCustomersForFilter.length > 0 && (
          <div style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            backgroundColor: '#e8f5e8',
            border: '1px solid #4caf50',
            borderRadius: '4px'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: '#2e7d32' }}>
              Selected Customers ({selectedCustomersForFilter.length}):
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              {selectedCustomersForFilter.map((customer, index) => (
                <span key={customer.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span
                    style={{
                      padding: '0.25rem 0.5rem',
                      backgroundColor: '#4caf50',
                      color: 'white',
                      borderRadius: '12px',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}
                  >
                    {customer.email}
                    <button
                      onClick={() => removeCustomerFromBreadcrumb(customer)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        marginLeft: '0.25rem',
                        padding: '0',
                        width: '16px',
                        height: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      title="Remove this customer"
                    >
                      ×
                    </button>
                  </span>
                  {index < selectedCustomersForFilter.length - 1 && (
                    <span style={{ color: '#4caf50', fontSize: '0.9rem' }}>+</span>
                  )}
                </span>
              ))}
              <span style={{ 
                color: '#666', 
                fontSize: '0.8rem', 
                fontStyle: 'italic',
                marginLeft: '0.5rem'
              }}>
                Type after comma to add more...
              </span>
            </div>
            
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={applyMultiCustomerFilter}
                disabled={selectedCustomersForFilter.length === 0}
                style={{
                  padding: '0.5rem 1rem',
                  border: 'none',
                  borderRadius: '4px',
                  backgroundColor: selectedCustomersForFilter.length > 0 ? '#1976d2' : '#ccc',
                  color: 'white',
                  cursor: selectedCustomersForFilter.length > 0 ? 'pointer' : 'not-allowed',
                  fontSize: '0.9rem'
                }}
              >
                Apply Filter ({selectedCustomersForFilter.length})
              </button>
              <button
                onClick={clearMultiCustomerFilter}
                style={{
                  padding: '0.5rem 1rem',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  backgroundColor: 'white',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                Clear All
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        {/* UTR Validation Summary */}
        {payouts.some(payout => !payout.notes || !payout.notes.trim()) && (
          <div style={{ 
            backgroundColor: '#fff3cd', 
            border: '1px solid #ffeaa7', 
            borderRadius: '4px', 
            padding: '0.75rem', 
            marginBottom: '1rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ color: '#856404', fontSize: '0.9rem' }}>
              <strong>⚠️ UTR Validation Required:</strong> {payouts.filter(payout => !payout.notes || !payout.notes.trim()).length} payout(s) missing UTR
            </div>
            <button 
              onClick={() => {
                const payoutsWithoutUtr = payouts.filter(payout => !payout.notes || !payout.notes.trim());
                setMessage(`Found ${payoutsWithoutUtr.length} payout(s) without UTR. Please edit them to add UTR numbers.`);
              }}
              className="btn btn-warning btn-sm"
              style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
            >
              View Details
            </button>
          </div>
        )}
        
        {viewMode === 'list' ? (
          // List View
          <div>
            
            <table className="table" style={{ fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={{ padding: '0.5rem', width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={handleSelectAll}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th 
                  style={{ 
                    padding: '0.5rem', 
                    cursor: 'pointer',
                    backgroundColor: sortColumn === 'customer' ? '#e3f2fd' : 'transparent',
                    userSelect: 'none'
                  }}
                  onClick={() => handleSort('customer')}
                  title="Click to sort by customer name (A-Z or Z-A)"
                >
                  Customer (Total Payments)
                  {sortColumn === 'customer' && (
                    <span style={{ marginLeft: '5px', fontSize: '0.9em', color: '#1976d2' }}>
                      {sortDirection === 'asc' ? '↑ A-Z' : '↓ Z-A'}
                    </span>
                  )}
                  {sortColumn !== 'customer' && (
                    <span style={{ marginLeft: '5px', fontSize: '0.8em', color: '#666', opacity: 0.7 }}>
                      ↕
                    </span>
                  )}
                </th>
                <th 
                  style={{ 
                    padding: '0.5rem', 
                    cursor: 'pointer',
                    backgroundColor: sortColumn === 'amount' ? '#e3f2fd' : 'transparent',
                    userSelect: 'none'
                  }}
                  onClick={() => handleSort('amount')}
                  title="Click to sort by amount (lowest/highest first)"
                >
                  Amount
                  {sortColumn === 'amount' && (
                    <span style={{ marginLeft: '5px', fontSize: '0.9em', color: '#1976d2' }}>
                      {sortDirection === 'asc' ? '↑ Lowest First' : '↓ Highest First'}
                    </span>
                  )}
                  {sortColumn !== 'amount' && (
                    <span style={{ marginLeft: '5px', fontSize: '0.8em', color: '#666', opacity: 0.7 }}>
                      ↕
                    </span>
                  )}
                </th>
                <th 
                  style={{ 
                    padding: '0.5rem', 
                    cursor: 'pointer',
                    backgroundColor: sortColumn === 'date' ? '#e3f2fd' : 'transparent',
                    userSelect: 'none',
                    position: 'relative'
                  }}
                  onClick={() => handleSort('date')}
                  title="Click to sort by date (newest/oldest first)"
                >
                  Date
                  {sortColumn === 'date' && (
                    <span style={{ marginLeft: '5px', fontSize: '0.9em', color: '#1976d2' }}>
                      {sortDirection === 'asc' ? '↑ Oldest First' : '↓ Newest First'}
                    </span>
                  )}
                  {sortColumn !== 'date' && (
                    <span style={{ marginLeft: '5px', fontSize: '0.8em', color: '#666', opacity: 0.7 }}>
                      ↕
                    </span>
                  )}
                </th>
                <th 
                  style={{ 
                    padding: '0.5rem', 
                    cursor: 'pointer',
                    backgroundColor: sortColumn === 'utr' ? '#e3f2fd' : 'transparent',
                    userSelect: 'none'
                  }}
                  onClick={() => handleSort('utr')}
                >
                  UTR
                  {sortColumn === 'utr' && (
                    <span style={{ marginLeft: '5px' }}>
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th 
                  style={{ 
                    padding: '0.5rem', 
                    cursor: 'pointer',
                    backgroundColor: sortColumn === 'notes' ? '#e3f2fd' : 'transparent',
                    userSelect: 'none'
                  }}
                  onClick={() => handleSort('notes')}
                >
                  Notes
                  {sortColumn === 'notes' && (
                    <span style={{ marginLeft: '5px' }}>
                      {sortDirection === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </th>
                <th style={{ padding: '0.5rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {getPaginatedPayouts().map((payout) => (
                <tr key={payout.id} style={{ 
                  backgroundColor: selectedPayouts.includes(payout.id) ? '#fff3cd' : 
                    (!payout.notes || !payout.notes.trim()) ? '#fff5f5' : 'inherit',
                  borderLeft: (!payout.notes || !payout.notes.trim()) ? '4px solid #dc3545' : 'inherit'
                }}>
                  <td style={{ padding: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedPayouts.includes(payout.id)}
                      onChange={() => handleSelectPayout(payout.id)}
                      style={{ cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>
                        {payout.customers?.email || 'Unknown'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem' }}>
                        Total: ₹{getCustomerTotalPayments(payout.customers?.email).toLocaleString()}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '0.5rem' }} className="negative">₹{payout.amount_inr.toLocaleString()}</td>
                  <td style={{ padding: '0.5rem' }}>{format(new Date(payout.date), 'MMM dd, yyyy')}</td>
                  <td style={{ 
                    padding: '0.5rem',
                    backgroundColor: !payout.notes || !payout.notes.trim() ? '#fff5f5' : 'inherit',
                    border: !payout.notes || !payout.notes.trim() ? '2px solid #dc3545' : 'inherit',
                    borderRadius: !payout.notes || !payout.notes.trim() ? '4px' : 'inherit'
                  }}>
                    {payout.notes || (
                      <span style={{ color: '#dc3545', fontWeight: 'bold', fontSize: '0.8rem' }}>
                        ⚠️ UTR Required
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.5rem' }}>{payout.notes ? '-' : 'UTR Missing'}</td>
                  <td style={{ padding: '0.5rem' }} className="actions">
                    <button onClick={() => handleEdit(payout)} className="btn btn-primary btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
                      Edit
                    </button>
                    <button onClick={() => handleDelete(payout.id)} className="btn btn-danger btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginLeft: '0.25rem' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
                    {/* Load More Controls for List View */}
          {getFilteredPayouts().length > 0 && (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginTop: '1rem',
              padding: '1rem',
              borderTop: '1px solid #ddd'
            }}>
              <div style={{ fontSize: '0.9rem', color: '#666' }}>
                Showing {getFilteredPayouts().length} payouts
                {hasMoreData && (
                  <span style={{ marginLeft: '1rem', color: '#007bff' }}>
                    • More data available
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {hasMoreData && (
                  <button 
                    onClick={loadMorePayouts}
                    disabled={isLoadingMore}
                    className="btn btn-primary btn-sm"
                  >
                    {isLoadingMore ? 'Loading...' : 'Load More'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
                 ) : (
           // Grouped View
           <div>
             {/* Search Box for Grouped View */}
             <div style={{ marginBottom: '1rem' }}>
               <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
                 <div style={{ flex: 1 }}>
                   <input
                     type="text"
                     placeholder="Search by customer email(s) (comma-separated), amount, UTR, notes, or date..."
                     value={searchTerm}
                     onChange={(e) => {
                       setSearchTerm(e.target.value);
                     }}
                     style={{
                       width: '100%',
                       padding: '0.5rem',
                       border: '1px solid #ddd',
                       borderRadius: '4px',
                       fontSize: '0.9rem'
                     }}
                   />
                 </div>
               </div>
             </div>
             
             {/* Summary Card */}
             <div style={{ 
               backgroundColor: '#f8f9fa', 
               border: '1px solid #ddd', 
               borderRadius: '8px', 
               padding: '1rem', 
               marginBottom: '1rem',
               display: 'flex',
               justifyContent: 'space-between',
               alignItems: 'center'
             }}>
               <div>
                 <h4 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 'bold' }}>
                   📊 Payouts Summary
                 </h4>
                 <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.25rem' }}>
                   {getGroupedPayouts().length} customer(s) • {getFilteredPayouts().length} total payout(s)
                   {hasMoreData && (
                     <span style={{ marginLeft: '0.5rem', color: '#007bff' }}>
                       • More available
                     </span>
                   )}
                 </div>
               </div>
               <div style={{ textAlign: 'right' }}>
                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                   <div>
                     <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#dc3545' }}>
                       ₹{getFilteredPayouts().reduce((total, payout) => total + payout.amount_inr, 0).toLocaleString()}
                     </div>
                     <div style={{ fontSize: '0.8rem', color: '#666' }}>
                       Total Payouts
                     </div>
                   </div>
                   <div>
                     <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#28a745' }}>
                       ₹{paymentsData.reduce((total, payment) => total + (parseFloat(payment.amount_inr) || 0), 0).toLocaleString()}
                     </div>
                     <div style={{ fontSize: '0.8rem', color: '#666' }}>
                       Total Deposits
                     </div>
                   </div>
                 </div>
               </div>
             </div>
             
             {getPaginatedGroupedPayouts().map((group, groupIndex) => (
              <div key={group.customerEmail} style={{ 
                border: '1px solid #ddd', 
                borderRadius: '8px', 
                marginBottom: '1rem',
                overflow: 'hidden'
              }}>
                {/* Customer Header */}
                <div style={{ 
                  backgroundColor: '#f8f9fa', 
                  padding: '1rem', 
                  borderBottom: '1px solid #ddd',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold' }}>
                      {group.customerEmail}
                    </h4>
                    <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.25rem' }}>
                      {group.payoutCount} payout(s) • Total Payouts: <span style={{ fontWeight: 'bold', color: '#dc3545' }}>₹{group.totalAmount.toLocaleString()}</span>
                      <br />
                      Total Deposits: <span style={{ fontWeight: 'bold', color: '#28a745' }}>₹{getCustomerTotalDeposits(group.customerEmail).toLocaleString()}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#dc3545' }}>
                      ₹{group.totalAmount.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>
                      Total Payouts
                    </div>
                    <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#28a745', marginTop: '0.25rem' }}>
                      ₹{getCustomerTotalDeposits(group.customerEmail).toLocaleString()}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>
                      Total Deposits
                    </div>
                  </div>
                </div>
                
                {/* Payouts Table */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ 
                    width: '100%', 
                    borderCollapse: 'collapse',
                    fontSize: '0.9rem'
                  }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8f9fa' }}>
                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #ddd', textAlign: 'left' }}>Amount</th>
                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #ddd', textAlign: 'left' }}>Date</th>
                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #ddd', textAlign: 'left' }}>UTR</th>
                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #ddd', textAlign: 'left' }}>Notes</th>
                        <th style={{ padding: '0.75rem', borderBottom: '1px solid #ddd', textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.payouts.map((payout) => (
                        <tr key={payout.id} style={{ 
                          backgroundColor: (!payout.notes || !payout.notes.trim()) ? '#fff5f5' : 'inherit',
                          borderLeft: (!payout.notes || !payout.notes.trim()) ? '4px solid #dc3545' : 'inherit'
                        }}>
                          <td style={{ padding: '0.75rem', borderBottom: '1px solid #eee', fontWeight: 'bold', color: '#dc3545' }}>
                            ₹{payout.amount_inr.toLocaleString()}
                          </td>
                          <td style={{ padding: '0.75rem', borderBottom: '1px solid #eee' }}>
                            {format(new Date(payout.date), 'MMM dd, yyyy')}
                          </td>
                          <td style={{ 
                            padding: '0.75rem', 
                            borderBottom: '1px solid #eee',
                            backgroundColor: !payout.notes || !payout.notes.trim() ? '#fff5f5' : 'inherit',
                            border: !payout.notes || !payout.notes.trim() ? '2px solid #dc3545' : 'inherit',
                            borderRadius: !payout.notes || !payout.notes.trim() ? '4px' : 'inherit'
                          }}>
                            {payout.notes || (
                              <span style={{ color: '#dc3545', fontWeight: 'bold', fontSize: '0.8rem' }}>
                                ⚠️ UTR Required
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.75rem', borderBottom: '1px solid #eee' }}>
                            {payout.notes ? '-' : 'UTR Missing'}
                          </td>
                          <td style={{ padding: '0.75rem', borderBottom: '1px solid #eee', textAlign: 'center' }}>
                            <button onClick={() => handleEdit(payout)} className="btn btn-primary btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
                              Edit
                            </button>
                            <button onClick={() => handleDelete(payout.id)} className="btn btn-danger btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginLeft: '0.25rem' }}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            
            {/* Load More Controls for Grouped View */}
            {getGroupedPayouts().length > 0 && (
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginTop: '1rem',
                padding: '1rem',
                borderTop: '1px solid #ddd'
              }}>
                <div style={{ fontSize: '0.9rem', color: '#666' }}>
                  Showing {getGroupedPayouts().length} customers
                  {hasMoreData && (
                    <span style={{ marginLeft: '1rem', color: '#007bff' }}>
                      • More data available
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {hasMoreData && (
                    <button 
                      onClick={loadMorePayouts}
                      disabled={isLoadingMore}
                      className="btn btn-primary btn-sm"
                    >
                      {isLoadingMore ? 'Loading...' : 'Load More'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        
        {payouts.length === 0 && (
          <div style={{ textAlign: 'center', color: '#666', padding: '2rem' }}>
            {!selectedCustomerForFilter ? (
              <>
                <h3>Select a Customer to View Payouts</h3>
                <p>Use the search box above to find and select a customer.</p>
                <p>Only payouts for the selected customer will be displayed.</p>
              </>
            ) : (
              <>
                <h3>No Payouts Found</h3>
                <p>No payouts found for {selectedCustomerForFilter.email}.</p>
                <p>Add some payouts using the buttons above to get started.</p>
              </>
            )}
          </div>
        )}
        
        {/* Load More Button - Only show for general search (not customer-specific) */}
        {hasMoreData && !selectedCustomerForFilter && (
          <div style={{ textAlign: 'center', marginTop: '1rem', padding: '1rem' }}>
            <button 
              onClick={() => fetchPayoutsData(true)} 
              className="btn btn-primary"
              disabled={isLoadingMore}
              style={{ 
                padding: '0.75rem 2rem', 
                fontSize: '1rem',
                backgroundColor: isLoadingMore ? '#6c757d' : '#007bff',
                border: 'none',
                borderRadius: '4px',
                color: 'white',
                cursor: isLoadingMore ? 'not-allowed' : 'pointer'
              }}
            >
              {isLoadingMore ? 'Loading More...' : `Load More (${totalLoaded} loaded)`}
            </button>
            <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem' }}>
              {isLoadingMore ? 'Please wait while we load the next 1000 records...' : 'Click to load the next 1000 payout records'}
            </div>
          </div>
        )}

      </div>

      {/* Bulk Upload Editor */}
      {showBulkEditor && (
        <BulkUploadEditor
          type="payouts"
          csvData={bulkEditorData}
          onSave={handleBulkEditorSave}
          onCancel={handleBulkEditorCancel}
          customers={customers}
        />
      )}

      
    </div>
  );
}

export default Payouts;
