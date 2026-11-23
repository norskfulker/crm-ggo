import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import Papa from 'papaparse';

function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState({
    email: ''
  });
  const [message, setMessage] = useState('');
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const fileInputRef = useRef(null);
  const [sortField, setSortField] = useState('email');
  const [sortDirection, setSortDirection] = useState('asc');
  const [tags, setTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'grouped'
  const [filterTag, setFilterTag] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Pagination and lazy loading state
  const [payoutsLoading, setPayoutsLoading] = useState(false);
  const [showLoadAllPayouts, setShowLoadAllPayouts] = useState(false);
  const [allPayoutsLoaded, setAllPayoutsLoaded] = useState(false);
  const [payoutsData, setPayoutsData] = useState([]);


  useEffect(() => {
    fetchCustomers();
    fetchTags();
  }, []);

  // Effect to check if we need to show "Load All Payouts" button
  useEffect(() => {
    console.log('=== STATE DEBUG ===');
    console.log('customers.length:', customers.length);
    console.log('allPayoutsLoaded:', allPayoutsLoaded);
    console.log('showLoadAllPayouts:', showLoadAllPayouts);
    console.log('payoutsData.length:', payoutsData.length);
    
    // Only show "Load All Payouts" if we have exactly 1000 records and haven't loaded all yet
    if (payoutsData.length === 1000 && !allPayoutsLoaded) {
      console.log('Setting showLoadAllPayouts to true (exactly 1000 records)');
      setShowLoadAllPayouts(true);
    } else if (payoutsData.length < 1000) {
      console.log('All payouts loaded (less than 1000 records)');
      setAllPayoutsLoaded(true);
      setShowLoadAllPayouts(false);
    }
  }, [customers, allPayoutsLoaded, showLoadAllPayouts, payoutsData.length]);

  // Add a refresh function that can be called from other components
  const refreshCustomers = () => {
    fetchCustomers();
  };

  // Debug function to check specific customer payouts
  const debugCustomerPayouts = async (customerId) => {
    try {
      console.log('=== DEBUGGING CUSTOMER PAYOUTS ===');
      console.log('Customer ID:', customerId);
      console.log('Customer ID type:', typeof customerId);
      
      // Direct query for customer payouts
      const { data: directPayouts, error: directError } = await supabase
        .from('payouts')
        .select('*')
        .eq('customer_id', customerId);
      
      if (directError) {
        console.error('Direct query error:', directError);
        return;
      }
      
      console.log('Direct payouts query result:', directPayouts);
      console.log('Number of payouts found:', directPayouts?.length || 0);
      
      if (directPayouts && directPayouts.length > 0) {
        const total = directPayouts.reduce((sum, p) => sum + (parseFloat(p.amount_inr) || 0), 0);
        console.log('Total amount from direct query:', total);
        console.log('Individual payout amounts:', directPayouts.map(p => ({ id: p.id, amount: p.amount_inr, customer_id: p.customer_id })));
      }
      
      // Also check the customer exists
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single();
      
      if (customerError) {
        console.error('Customer query error:', customerError);
      } else {
        console.log('Customer found:', customer);
      }
      
             // Check all payouts in the system for this customer
       const { data: allPayouts, error: allPayoutsError } = await supabase
         .from('payouts')
         .select('*')
         .limit(10000); // Increase limit to ensure we get all payouts
       
       if (!allPayoutsError && allPayouts) {
         console.log('All payouts in system:', allPayouts.length);
         
         // Debug the first few payouts to see the data format
         console.log('Sample payouts customer_id format:', allPayouts.slice(0, 5).map(p => ({
           id: p.id,
           customer_id: p.customer_id,
           customer_id_type: typeof p.customer_id,
           customer_id_length: p.customer_id ? p.customer_id.length : 0
         })));
         
         const matchingPayouts = allPayouts.filter(p => 
           normalizeUUID(p.customer_id) === normalizeUUID(customerId)
         );
         console.log('Payouts matching this customer ID:', matchingPayouts.length);
         console.log('Matching payouts:', matchingPayouts.map(p => ({ id: p.id, amount: p.amount_inr, customer_id: p.customer_id })));
         
         // Try different comparison methods
         const matchingPayouts2 = allPayouts.filter(p => p.customer_id === customerId);
         console.log('Payouts matching with strict equality:', matchingPayouts2.length);
         
         const matchingPayouts3 = allPayouts.filter(p => 
           normalizeUUID(p.customer_id) === normalizeUUID(customerId)
         );
         console.log('Payouts matching with normalized comparison:', matchingPayouts3.length);
       }
      
      console.log('=== END DEBUGGING ===');
    } catch (error) {
      console.error('Debug function error:', error);
    }
  };

  // Expose the refresh function globally for other components to use
  useEffect(() => {
    window.refreshCustomersList = refreshCustomers;
         // Add a specific debug function for the problematic customer
     window.debugSpecificCustomer = async () => {
       const customerId = '4b96557b-a516-4d66-b95e-9f279e8a8502';
       console.log('=== DEBUGGING SPECIFIC CUSTOMER ===');
       console.log('Customer ID:', customerId);
       
       // Check if this customer exists
       const { data: customer, error: customerError } = await supabase
         .from('customers')
         .select('*')
         .eq('id', customerId)
         .single();
       
       if (customerError) {
         console.error('Customer not found:', customerError);
         return;
       }
       
       console.log('Customer found:', customer);
       
       // Get all payouts for this customer
       const { data: payouts, error: payoutsError } = await supabase
         .from('payouts')
         .select('*')
         .eq('customer_id', customerId);
       
       if (payoutsError) {
         console.error('Error fetching payouts:', payoutsError);
         return;
       }
       
       console.log('Payouts found:', payouts?.length || 0);
       console.log('Payouts data:', payouts);
       
       if (payouts && payouts.length > 0) {
         const total = payouts.reduce((sum, p) => sum + (parseFloat(p.amount_inr) || 0), 0);
         console.log('Total payouts amount:', total);
       }
       
       // Check the current customers state
       const currentCustomer = customers.find(c => c.id === customerId);
       console.log('Current customer in state:', currentCustomer);
       console.log('Current customer totalPayouts:', currentCustomer?.totalPayouts);
       
       console.log('=== END DEBUGGING SPECIFIC CUSTOMER ===');
     };

           // Add a function to reset pagination state for testing
      window.resetPaginationState = () => {
        console.log('=== RESETTING PAGINATION STATE ===');
        setAllPayoutsLoaded(false);
        setShowLoadAllPayouts(true);
        setPayoutsLoading(false);
        console.log('Pagination state reset. You can now try loading all payouts again.');
      };

      // Add a function to check total payouts count
      window.checkTotalPayouts = async () => {
        console.log('=== CHECKING TOTAL PAYOUTS COUNT ===');
        try {
          const { count, error } = await supabase
            .from('payouts')
            .select('*', { count: 'exact', head: true });
          
          if (error) {
            console.error('Error getting count:', error);
          } else {
            console.log('Total payouts in database:', count);
            console.log('Currently loaded payouts:', payoutsData.length);
            console.log('Difference:', count - payoutsData.length);
          }
        } catch (error) {
          console.error('Error in checkTotalPayouts:', error);
        }
      };
    
         return () => {
       delete window.refreshCustomersList;
       delete window.debugSpecificCustomer;
       delete window.resetPaginationState;
       delete window.checkTotalPayouts;
     };
  }, [customers]);

  const fetchCustomers = async () => {
    try {
      // Fetch customers with their payment and payout totals
      const { data: customersData, error: customersError } = await supabase
        .from('customers')
        .select('*')
        .order('email');

      if (customersError) throw customersError;

      // Fetch payments totals for each customer
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select('customer_id, amount_inr');

      if (paymentsError) throw paymentsError;

      // Fetch payouts totals for each customer - initially only first 1000 records
      const { data: payoutsData, error: payoutsError } = await supabase
        .from('payouts')
        .select('customer_id, amount_inr')
        .limit(1000); // Start with first 1000 records

      if (payoutsError) throw payoutsError;
      
      console.log('Initial payouts fetch:', payoutsData?.length || 0, 'records');
      
      // Store payouts data for later use
      setPayoutsData(payoutsData || []);
      
      // Check if there might be more payouts by trying to fetch one more record
      if (payoutsData && payoutsData.length === 1000) {
        console.log('Checking if there are more payouts...');
        const { data: extraRecord, error: extraError } = await supabase
          .from('payouts')
          .select('customer_id, amount_inr')
          .range(1000, 1000);
        
        if (!extraError && extraRecord && extraRecord.length > 0) {
          console.log('More payouts found beyond 1000, setting showLoadAllPayouts to true');
          setShowLoadAllPayouts(true);
          setAllPayoutsLoaded(false);
        } else {
          console.log('No more payouts found, all loaded');
          setAllPayoutsLoaded(true);
          setShowLoadAllPayouts(false);
        }
      } else if (payoutsData && payoutsData.length < 1000) {
        console.log('All payouts loaded (less than 1000 records)');
        setAllPayoutsLoaded(true);
        setShowLoadAllPayouts(false);
      }
      
      // Calculate customer totals using the new function
      await calculateCustomerTotals(payoutsData || []);
    } catch (error) {
      console.error('Error fetching customers:', error);
      setMessage('Error fetching customers');
    } finally {
      setLoading(false);
    }
  };

  // Function to load all payouts
  const loadAllPayouts = async () => {
    console.log('=== LOAD ALL PAYOUTS STARTED ===');
    setPayoutsLoading(true);
    try {
      console.log('Fetching all payouts...');
      
      // Fetch all payouts using pagination to get beyond the 1000 limit
      let allPayoutsData = [];
      let hasMore = true;
      let from = 0;
      const pageSize = 1000;
      
      while (hasMore) {
        console.log(`Fetching payouts from ${from} to ${from + pageSize}...`);
        const { data: pageData, error: payoutsError } = await supabase
          .from('payouts')
          .select('customer_id, amount_inr')
          .range(from, from + pageSize - 1);

        if (payoutsError) {
          console.error('Payouts fetch error:', payoutsError);
          throw payoutsError;
        }
        
        if (pageData && pageData.length > 0) {
          allPayoutsData = [...allPayoutsData, ...pageData];
          from += pageSize;
          
          // If we got less than pageSize, we've reached the end
          if (pageData.length < pageSize) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }
      
      console.log('All payouts fetched:', allPayoutsData?.length || 0, 'records');
      console.log('Sample payouts data:', allPayoutsData?.slice(0, 3));
      
      setPayoutsData(allPayoutsData || []);
      setAllPayoutsLoaded(true);
      setShowLoadAllPayouts(false);
      
      console.log('Recalculating customer totals...');
      // Recalculate customer totals with all payouts
      await calculateCustomerTotals(allPayoutsData || []);
      console.log('=== LOAD ALL PAYOUTS COMPLETED ===');
      
    } catch (error) {
      console.error('Error loading all payouts:', error);
      setMessage('Error loading all payouts');
    } finally {
      setPayoutsLoading(false);
    }
  };

  // Function to calculate customer totals
  const calculateCustomerTotals = async (payoutsDataToUse) => {
    console.log('=== CALCULATE CUSTOMER TOTALS STARTED ===');
    console.log('Payouts data to use:', payoutsDataToUse?.length || 0, 'records');
    try {
      // Fetch payments totals for each customer
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select('customer_id, amount_inr');

      if (paymentsError) throw paymentsError;
      console.log('Payments data fetched:', paymentsData?.length || 0, 'records');

      // Fetch tags for each customer
      const { data: customerTagsData, error: customerTagsError } = await supabase
        .from('customer_tags')
        .select(`
          customer_id,
          tags (
            id,
            name,
            color
          )
        `);

      if (customerTagsError) throw customerTagsError;
      console.log('Customer tags data fetched:', customerTagsData?.length || 0, 'records');

      // Fetch customers
      const { data: customersData, error: customersError } = await supabase
        .from('customers')
        .select('*')
        .order('email');

      if (customersError) throw customersError;
      console.log('Customers data fetched:', customersData?.length || 0, 'records');

      // Calculate totals for each customer
      const customersWithTotals = customersData.map(customer => {
        const customerPayments = paymentsData.filter(payment => {
          return normalizeUUID(payment.customer_id) === normalizeUUID(customer.id);
        });
        
        const customerPayouts = payoutsDataToUse.filter(payout => {
          return normalizeUUID(payout.customer_id) === normalizeUUID(customer.id);
        });
        
                 const totalDeposits = customerPayments.reduce((sum, payment) => {
           const amount = parseFloat(payment.amount_inr) || 0;
           return sum + amount;
         }, 0);

         const totalPayouts = customerPayouts.reduce((sum, payout) => {
           const amount = parseFloat(payout.amount_inr) || 0;
           return sum + amount;
         }, 0);

         // Apply default deposit logic: if customer has payouts but no deposits, assign ₹10,000 default deposit
         let effectiveDeposits = totalDeposits;
         let hasDefaultDeposit = false;
         
         if (totalDeposits === 0 && totalPayouts > 0) {
           effectiveDeposits = 10000; // Default ₹10,000 deposit
           hasDefaultDeposit = true;
         }

         const returnPercentage = effectiveDeposits > 0 
           ? ((totalPayouts / effectiveDeposits) * 100).toFixed(2)
           : '0.00';

        // Get tags for this customer
        const customerTags = customerTagsData
          .filter(ct => normalizeUUID(ct.customer_id) === normalizeUUID(customer.id))
          .map(ct => ct.tags)
          .filter(Boolean);

                 return {
           ...customer,
           totalDeposits,
           totalPayouts,
           effectiveDeposits, // Include effective deposits (with default if applicable)
           hasDefaultDeposit, // Flag to indicate if default deposit was applied
           returnPercentage,
           tags: customerTags
         };
      });

      console.log('Customers with totals calculated:', customersWithTotals?.length || 0);
      console.log('Sample customer with totals:', customersWithTotals?.[0]);
      setCustomers(customersWithTotals || []);
      console.log('=== CALCULATE CUSTOMER TOTALS COMPLETED ===');
    } catch (error) {
      console.error('Error calculating customer totals:', error);
    }
  };

  // Utility function to normalize UUIDs for comparison
  const normalizeUUID = (uuid) => {
    if (!uuid) return null;
    return String(uuid).toLowerCase().trim();
  };

  const fetchTags = async () => {
    try {
      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .order('name');

      if (error) throw error;
      setTags(data || []);
    } catch (error) {
      console.error('Error fetching tags:', error);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getFilteredAndSortedCustomers = () => {
    let filtered = [...customers];

    // Filter by search term
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
             filtered = filtered.filter(customer => 
         customer.email.toLowerCase().includes(searchLower) ||
         (customer.totalDeposits && customer.totalDeposits.toString().includes(searchTerm)) ||
         (customer.effectiveDeposits && customer.effectiveDeposits.toString().includes(searchTerm)) ||
         (customer.totalPayouts && customer.totalPayouts.toString().includes(searchTerm)) ||
         (customer.returnPercentage && customer.returnPercentage.toString().includes(searchTerm))
       );
    }

    // Filter by tag if selected
    if (filterTag) {
      filtered = filtered.filter(customer => 
        customer.tags && customer.tags.some(tag => tag.id === filterTag)
      );
    }

    // Sort customers
    const sorted = filtered.sort((a, b) => {
      let aValue, bValue;

      switch (sortField) {
        case 'email':
          aValue = a.email.toLowerCase();
          bValue = b.email.toLowerCase();
          break;
                 case 'totalDeposits':
           aValue = a.effectiveDeposits || 0;
           bValue = b.effectiveDeposits || 0;
           break;
        case 'totalPayouts':
          aValue = a.totalPayouts || 0;
          bValue = b.totalPayouts || 0;
          break;
        case 'returnPercentage':
          aValue = parseFloat(a.returnPercentage || 0);
          bValue = parseFloat(b.returnPercentage || 0);
          break;
        case 'created_at':
          aValue = new Date(a.created_at);
          bValue = new Date(b.created_at);
          break;
        default:
          aValue = a[sortField];
          bValue = b[sortField];
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  };



  const getGroupedCustomers = () => {
    const filtered = getFilteredAndSortedCustomers();
    const grouped = {};

    // Group by tags
    filtered.forEach(customer => {
      if (customer.tags && customer.tags.length > 0) {
        customer.tags.forEach(tag => {
          if (!grouped[tag.id]) {
            grouped[tag.id] = {
              tag,
              customers: []
            };
          }
          grouped[tag.id].customers.push(customer);
        });
      } else {
        // Customers without tags
        if (!grouped['untagged']) {
          grouped['untagged'] = {
            tag: { name: 'No Tags', color: '#6B7280' },
            customers: []
          };
        }
        grouped['untagged'].customers.push(customer);
      }
    });

    return grouped;
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return '↕️';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (editingCustomer) {
        // Update customer
        const { error } = await supabase
          .from('customers')
          .update(formData)
          .eq('id', editingCustomer.id);

        if (error) throw error;

        // Update customer tags
        await updateCustomerTags(editingCustomer.id, selectedTags);
        
        setMessage('Customer updated successfully');
      } else {
        // Insert new customer
        const { data, error } = await supabase
          .from('customers')
          .insert([formData])
          .select();

        if (error) throw error;

        // Add tags to new customer
        if (data && data[0] && selectedTags.length > 0) {
          await updateCustomerTags(data[0].id, selectedTags);
        }

        setMessage('Customer added successfully');
      }

      setFormData({ email: '' });
      setSelectedTags([]);
      setShowForm(false);
      setEditingCustomer(null);
      fetchCustomers();
    } catch (error) {
      console.error('Error saving customer:', error);
      setMessage('Error saving customer');
    } finally {
      setLoading(false);
    }
  };

  const updateCustomerTags = async (customerId, tagIds) => {
    try {
      // Remove existing tags
      await supabase
        .from('customer_tags')
        .delete()
        .eq('customer_id', customerId);

      // Add new tags
      if (tagIds.length > 0) {
        const tagMappings = tagIds.map(tagId => ({
          customer_id: customerId,
          tag_id: tagId
        }));

        await supabase
          .from('customer_tags')
          .insert(tagMappings);
      }
    } catch (error) {
      console.error('Error updating customer tags:', error);
      throw error;
    }
  };

  const handleEdit = (customer) => {
    setEditingCustomer(customer);
    setFormData({
      email: customer.email || ''
    });
    setSelectedTags(customer.tags ? customer.tags.map(tag => tag.id) : []);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this customer?')) return;

    try {
      const { error } = await supabase
        .from('customers')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setMessage('Customer deleted successfully');
      fetchCustomers();
    } catch (error) {
      console.error('Error deleting customer:', error);
      setMessage('Error deleting customer');
    }
  };

  const handleRemoveZeroBalanceCustomers = async () => {
    // Find customers with zero balance (totalDeposits === totalPayouts)
    const zeroBalanceCustomers = customers.filter(customer => {
      const totalDeposits = customer.totalDeposits || 0;
      const totalPayouts = customer.totalPayouts || 0;
      return totalDeposits === totalPayouts && totalDeposits === 0;
    });

    if (zeroBalanceCustomers.length === 0) {
      setMessage('No customers with zero balance found.');
      return;
    }

    const confirmMessage = `Are you sure you want to remove ${zeroBalanceCustomers.length} customer(s) with zero balance?\n\nThis will permanently delete:\n${zeroBalanceCustomers.map(c => `• ${c.email}`).join('\n')}`;
    
    if (!window.confirm(confirmMessage)) return;

    setLoading(true);
    try {
      // Delete customers one by one to handle any potential foreign key constraints
      for (const customer of zeroBalanceCustomers) {
        // First delete customer tags
        await supabase
          .from('customer_tags')
          .delete()
          .eq('customer_id', customer.id);

        // Then delete the customer
        const { error } = await supabase
          .from('customers')
          .delete()
          .eq('id', customer.id);

        if (error) {
          console.error(`Error deleting customer ${customer.email}:`, error);
          throw error;
        }
      }

      setMessage(`Successfully removed ${zeroBalanceCustomers.length} customer(s) with zero balance.`);
      fetchCustomers();
    } catch (error) {
      console.error('Error removing zero balance customers:', error);
      setMessage('Error removing zero balance customers. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingCustomer(null);
    setFormData({ email: '' });
    setSelectedTags([]);
  };

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };



     const exportToCSV = () => {
     const exportData = customers.map(customer => ({
       Email: customer.email,
       'Actual Deposits': customer.totalDeposits || 0,
       'Effective Deposits': customer.effectiveDeposits || 0,
       'Default Deposit Applied': customer.hasDefaultDeposit ? 'Yes' : 'No',
       'Total Payouts': customer.totalPayouts || 0,
       'Return %': customer.returnPercentage || '0.00',
       'Created At': new Date(customer.created_at).toLocaleDateString()
     }));
    
    const csv = Papa.unparse(exportData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'customers.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
          console.error('CSV parsing errors:', results.errors);
          // Filter out the delimiter warning as it's not a real error
          const realErrors = results.errors.filter(error => 
            !error.message.includes('Unable to auto-detect delimiting character')
          );
          
          if (realErrors.length > 0) {
            setMessage(`Error parsing CSV file: ${realErrors[0].message || 'Please check the format.'}`);
            return;
          }
        }

        // Check if the CSV has the required email column
        if (!results.data[0] || !results.data[0].hasOwnProperty('email')) {
          setMessage('CSV file must have an "email" column in the header row.');
          return;
        }

        // Filter rows that have email data
        const customers = results.data.filter(row => {
          return row.email && row.email.toString().trim() !== '';
        });
        
        if (customers.length === 0) {
          setMessage('No valid email data found in CSV. Please ensure the file has an "email" column with data.');
          return;
        }

        setUploadLoading(true);
        try {
          // Get existing customers to check for duplicates
          const { data: existingCustomers, error: fetchError } = await supabase
            .from('customers')
            .select('email');

          if (fetchError) throw fetchError;

          // Create a set of existing emails for quick lookup
          const existingEmails = new Set(existingCustomers.map(customer => customer.email.toLowerCase().trim()));

          // Process CSV data and filter out duplicates
          const customersToInsert = [];
          const duplicates = [];
          const newCustomers = [];

          customers.forEach(customer => {
            const email = customer.email.trim();
            const emailLower = email.toLowerCase();
            
            if (existingEmails.has(emailLower)) {
              duplicates.push(email);
            } else {
              customersToInsert.push({ email });
              newCustomers.push(email);
              existingEmails.add(emailLower);
            }
          });

          if (customersToInsert.length === 0) {
            setMessage('All emails in the CSV already exist in the database.');
            setShowUploadForm(false);
            if (fileInputRef.current) {
              fileInputRef.current.value = '';
            }
            setUploadLoading(false);
            return;
          }

          // Insert new customers
          const { error } = await supabase
            .from('customers')
            .insert(customersToInsert);

          if (error) throw error;

          // Prepare success message
          let message = `Successfully imported ${customersToInsert.length} new customers`;
          if (duplicates.length > 0) {
            message += `. Skipped ${duplicates.length} duplicate(s): ${duplicates.slice(0, 3).join(', ')}${duplicates.length > 3 ? '...' : ''}`;
          }

          setMessage(message);
          setShowUploadForm(false);
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
          fetchCustomers();
        } catch (error) {
          console.error('Error importing customers:', error);
          setMessage('Error importing customers. Please try again.');
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

  const downloadSampleCSV = () => {
    const sampleData = [
      { email: 'john.doe@example.com' },
      { email: 'jane.smith@example.com' },
      { email: 'bob.johnson@example.com' },
      { email: 'alice.wilson@example.com' },
      { email: 'mike.brown@example.com' }
    ];

    const csv = Papa.unparse(sampleData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'sample_customers.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading && customers.length === 0) {
    return (
      <div className="card">
        <h2>Loading customers...</h2>
      </div>
    );
  }

  return (
    <div>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
         <h2>Customers</h2>
         <div>
           <button onClick={() => setShowForm(true)} className="btn btn-primary">
             Add Customer
           </button>
           <button onClick={() => setShowUploadForm(true)} className="btn btn-success" style={{ marginLeft: '0.5rem' }}>
             Upload CSV
           </button>
                               <button onClick={exportToCSV} className="btn btn-secondary" style={{ marginLeft: '0.5rem' }}>
            Export CSV
          </button>
          <button onClick={fetchCustomers} className="btn btn-warning" style={{ marginLeft: '0.5rem' }} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh Data'}
          </button>
          {showLoadAllPayouts && !allPayoutsLoaded && (
            <button 
              onClick={() => {
                console.log('Load All Payouts button clicked!');
                loadAllPayouts();
              }} 
              className="btn btn-primary" 
              style={{ marginLeft: '0.5rem' }}
              disabled={payoutsLoading}
              title="Load all payouts (beyond 1000 records)"
            >
              {payoutsLoading ? 'Loading All Payouts...' : 'Load All Payouts'}
            </button>
          )}
          {allPayoutsLoaded && (
            <span style={{ marginLeft: '0.5rem', color: '#28a745', fontWeight: 'bold' }}>
              ✓ All Payouts Loaded
            </span>
          )}
                     <button 
             onClick={() => window.debugSpecificCustomer && window.debugSpecificCustomer()} 
             className="btn btn-info" 
             style={{ marginLeft: '0.5rem' }}
             title="Debug specific customer payouts"
           >
             Debug Customer
           </button>
                       <button 
              onClick={() => window.resetPaginationState && window.resetPaginationState()} 
              className="btn btn-warning" 
              style={{ marginLeft: '0.5rem' }}
              title="Reset pagination state for testing"
            >
              Reset Pagination
            </button>
            <button 
              onClick={() => window.checkTotalPayouts && window.checkTotalPayouts()} 
              className="btn btn-info" 
              style={{ marginLeft: '0.5rem' }}
              title="Check total payouts count"
            >
              Check Count
            </button>
          <button 
            onClick={handleRemoveZeroBalanceCustomers} 
            className="btn btn-danger" 
            style={{ marginLeft: '0.5rem' }}
            title="Remove customers with zero account balance"
          >
            Remove Zero Balance
          </button>
         </div>
       </div>

       {/* Payouts Loading Status */}
       {showLoadAllPayouts && !allPayoutsLoaded && (
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
           <div>
             <strong>⚠️ Partial Data Loaded:</strong> Only the first 1,000 payouts are currently loaded. 
             Some customer totals may be incomplete. Click "Load All Payouts" to load all records.
           </div>
           <button 
             onClick={() => {
               console.log('Load All Payouts banner button clicked!');
               loadAllPayouts();
             }} 
             className="btn btn-primary btn-sm"
             disabled={payoutsLoading}
           >
             {payoutsLoading ? 'Loading...' : 'Load All Payouts'}
           </button>
         </div>
       )}
       {allPayoutsLoaded && (
         <div style={{ 
           backgroundColor: '#d4edda', 
           border: '1px solid #c3e6cb', 
           borderRadius: '4px', 
           padding: '0.75rem', 
           marginBottom: '1rem',
           color: '#155724'
         }}>
           <strong>✓ Complete Data:</strong> All payouts have been loaded successfully.
         </div>
       )}

       {/* Search Box */}
       <div style={{ marginBottom: '1rem' }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
           <div style={{ flex: 1 }}>
             <input
               type="text"
               placeholder="Search customers, payments, payouts..."
               value={searchTerm}
               onChange={handleSearchChange}
               style={{
                 width: '100%',
                 padding: '0.75rem',
                 borderRadius: '4px',
                 border: '1px solid #ddd',
                 fontSize: '1rem'
               }}
             />
           </div>
         </div>
       </div>

       {/* View Mode and Filter Controls */}
       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
           <div>
             <label style={{ marginRight: '0.5rem' }}>View Mode:</label>
             <select 
               value={viewMode} 
               onChange={(e) => setViewMode(e.target.value)}
               style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
             >
               <option value="list">List View</option>
               <option value="grouped">Grouped by Tags</option>
             </select>
           </div>
           <div>
             <label style={{ marginRight: '0.5rem' }}>Filter by Tag:</label>
             <select 
               value={filterTag} 
               onChange={(e) => setFilterTag(e.target.value)}
               style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ddd' }}
             >
               <option value="">All Tags</option>
               {tags.map(tag => (
                 <option key={tag.id} value={tag.id}>{tag.name}</option>
               ))}
             </select>
           </div>

         </div>
         <div style={{ fontSize: '0.9rem', color: '#666' }}>
           {viewMode === 'list' && `${getFilteredAndSortedCustomers().length} customers`}
           {viewMode === 'grouped' && `${Object.keys(getGroupedCustomers()).length} groups`}
         </div>
       </div>

      {/* Summary Statistics */}
      <div className="dashboard-stats" style={{ marginBottom: '2rem' }}>
        <div className="stat-card">
          <h3>Total Customers</h3>
          <div className="amount">{customers.length}</div>
        </div>
                 <div className="stat-card">
           <h3>Total Deposits</h3>
           <div className="amount positive">
             ₹{customers.reduce((sum, customer) => sum + (customer.effectiveDeposits || 0), 0).toLocaleString()}
             {customers.some(c => c.hasDefaultDeposit) && (
               <div style={{ fontSize: '0.8rem', color: '#ff6b35', marginTop: '0.25rem' }}>
                 (Includes default deposits)
               </div>
             )}
           </div>
         </div>
        <div className="stat-card">
          <h3>Total Payouts</h3>
          <div className="amount negative">
            ₹{(() => {
              const totalPayouts = customers.reduce((sum, customer) => sum + (customer.totalPayouts || 0), 0);
              console.log('=== SUMMARY STATISTICS DEBUG ===');
              console.log('Total customers:', customers.length);
              console.log('Total payouts calculation:', totalPayouts);
              console.log('Individual customer payouts:', customers.map(c => ({ email: c.email, payouts: c.totalPayouts })));
              console.log('=== END SUMMARY STATISTICS DEBUG ===');
              
              // Add indicator if not all payouts are loaded
              if (!allPayoutsLoaded && showLoadAllPayouts) {
                return `${totalPayouts.toLocaleString()} (Partial - Load All for Complete)`;
              }
              return totalPayouts.toLocaleString();
            })()}
          </div>
        </div>
        <div className="stat-card">
          <h3>Avg Return %</h3>
          <div className="amount">
            {customers.length > 0 
              ? (customers.reduce((sum, customer) => sum + parseFloat(customer.returnPercentage || 0), 0) / customers.length).toFixed(2)
              : '0.00'}%
          </div>
        </div>
      </div>

      {message && (
        <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>
          {message}
        </div>
      )}

      {showForm && (
        <div className="card">
          <h3>{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email *</label>
              <input
                type="text"
                id="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Tags</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
                {tags.map(tag => (
                  <label key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <input
                      type="checkbox"
                      checked={selectedTags.includes(tag.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTags([...selectedTags, tag.id]);
                        } else {
                          setSelectedTags(selectedTags.filter(id => id !== tag.id));
                        }
                      }}
                    />
                    <span
                      style={{
                        backgroundColor: tag.color,
                        color: 'white',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '12px',
                        fontSize: '0.8rem',
                        fontWeight: 'bold'
                      }}
                    >
                      {tag.name}
                    </span>
                  </label>
                ))}
              </div>
              {tags.length === 0 && (
                <p style={{ color: '#666', fontSize: '0.9rem', marginTop: '0.5rem' }}>
                  No tags available. Create tags in the Tags section first.
                </p>
              )}
            </div>
            <div>
              <button type="submit" className="btn btn-success" disabled={loading}>
                {loading ? 'Saving...' : (editingCustomer ? 'Update' : 'Save')}
              </button>
              <button type="button" onClick={handleCancel} className="btn btn-secondary" style={{ marginLeft: '0.5rem' }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showUploadForm && (
        <div className="card">
          <h3>Upload Customers from CSV</h3>
          <div style={{ marginBottom: '1rem' }}>
            <p><strong>CSV Format Requirements:</strong></p>
            <ul style={{ marginLeft: '1rem', marginBottom: '1rem' }}>
              <li>First row should contain "email" as the header</li>
              <li>Each subsequent row should contain a valid email address</li>
              <li>Empty rows and invalid emails will be skipped</li>
              <li>Duplicate emails will be automatically skipped</li>
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
              <p>Uploading customers...</p>
            </div>
          )}
        </div>
      )}

             {viewMode === 'list' ? (
         <div className="card">
           <table className="table">
             <thead>
               <tr>
                 <th 
                   onClick={() => handleSort('email')} 
                   style={{ cursor: 'pointer', userSelect: 'none' }}
                   title="Click to sort"
                 >
                   Email {getSortIcon('email')}
                 </th>
                 <th>Tags</th>
                 <th 
                   onClick={() => handleSort('totalDeposits')} 
                   style={{ cursor: 'pointer', userSelect: 'none' }}
                   title="Click to sort"
                 >
                   Total Deposits {getSortIcon('totalDeposits')}
                 </th>
                 <th 
                   onClick={() => handleSort('totalPayouts')} 
                   style={{ cursor: 'pointer', userSelect: 'none' }}
                   title="Click to sort"
                 >
                   Total Payouts {getSortIcon('totalPayouts')}
                 </th>
                 <th 
                   onClick={() => handleSort('returnPercentage')} 
                   style={{ cursor: 'pointer', userSelect: 'none' }}
                   title="Click to sort"
                 >
                   Return % {getSortIcon('returnPercentage')}
                 </th>
                 <th 
                   onClick={() => handleSort('created_at')} 
                   style={{ cursor: 'pointer', userSelect: 'none' }}
                   title="Click to sort"
                 >
                   Created At {getSortIcon('created_at')}
                 </th>
                 <th>Actions</th>
               </tr>
             </thead>
             <tbody>
               {getFilteredAndSortedCustomers().map((customer) => (
                 <tr key={customer.id}>
                   <td>{customer.email}</td>
                   <td>
                     <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                       {customer.tags && customer.tags.map(tag => (
                         <span
                           key={tag.id}
                           style={{
                             backgroundColor: tag.color,
                             color: 'white',
                             padding: '0.25rem 0.5rem',
                             borderRadius: '12px',
                             fontSize: '0.75rem',
                             fontWeight: 'bold'
                           }}
                         >
                           {tag.name}
                         </span>
                       ))}
                     </div>
                   </td>
                                          <td className="positive">
                         ₹{customer.effectiveDeposits?.toLocaleString() || '0'}
                         {customer.hasDefaultDeposit && (
                           <span style={{ 
                             fontSize: '0.7rem', 
                             color: '#ff6b35', 
                             marginLeft: '0.5rem',
                             fontWeight: 'bold'
                           }} title="Default ₹10,000 deposit applied">
                             (Default)
                           </span>
                         )}
                       </td>
                   <td className="negative">₹{customer.totalPayouts?.toLocaleString() || '0'}</td>
                   <td style={{ 
                     color: parseFloat(customer.returnPercentage) >= 100 ? '#28a745' : 
                            parseFloat(customer.returnPercentage) >= 80 ? '#ffc107' : '#dc3545',
                     fontWeight: 'bold'
                   }}>
                     {customer.returnPercentage}%
                   </td>
                   <td>{new Date(customer.created_at).toLocaleDateString()}</td>
                   <td className="actions">
                     <button onClick={() => handleEdit(customer)} className="btn btn-primary btn-sm">
                       Edit
                     </button>
                     <button onClick={() => handleDelete(customer.id)} className="btn btn-danger btn-sm">
                       Delete
                     </button>
                     <button 
                       onClick={() => debugCustomerPayouts(customer.id)} 
                       className="btn btn-warning btn-sm"
                       style={{ marginLeft: '0.25rem', fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                       title="Debug payouts for this customer"
                     >
                       Debug
                     </button>
                   </td>
                 </tr>
               ))}
             </tbody>
           </table>
           

           
           {getFilteredAndSortedCustomers().length === 0 && <p>No customers found</p>}
         </div>
      ) : (
        <div className="card">
          {Object.entries(getGroupedCustomers()).map(([groupId, group]) => (
            <div key={groupId} style={{ marginBottom: '2rem' }}>
              <h3 style={{ 
                color: group.tag.color, 
                borderBottom: `2px solid ${group.tag.color}`,
                paddingBottom: '0.5rem',
                marginBottom: '1rem'
              }}>
                {group.tag.name} ({group.customers.length} customers)
              </h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Total Deposits</th>
                    <th>Total Payouts</th>
                    <th>Return %</th>
                    <th>Created At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.customers.map((customer) => (
                    <tr key={customer.id}>
                      <td>{customer.email}</td>
                      <td className="positive">
                      ₹{customer.effectiveDeposits?.toLocaleString() || '0'}
                      {customer.hasDefaultDeposit && (
                        <span style={{ 
                          fontSize: '0.7rem', 
                          color: '#ff6b35', 
                          marginLeft: '0.5rem',
                          fontWeight: 'bold'
                        }} title="Default ₹10,000 deposit applied">
                          (Default)
                        </span>
                      )}
                    </td>
                      <td className="negative">₹{customer.totalPayouts?.toLocaleString() || '0'}</td>
                      <td style={{ 
                        color: parseFloat(customer.returnPercentage) >= 100 ? '#28a745' : 
                               parseFloat(customer.returnPercentage) >= 80 ? '#ffc107' : '#dc3545',
                        fontWeight: 'bold'
                      }}>
                        {customer.returnPercentage}%
                      </td>
                      <td>{new Date(customer.created_at).toLocaleDateString()}</td>
                      <td className="actions">
                        <button onClick={() => handleEdit(customer)} className="btn btn-primary btn-sm">
                          Edit
                        </button>
                        <button onClick={() => handleDelete(customer.id)} className="btn btn-danger btn-sm">
                          Delete
                        </button>
                        <button 
                          onClick={() => debugCustomerPayouts(customer.id)} 
                          className="btn btn-warning btn-sm"
                          style={{ marginLeft: '0.25rem', fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                          title="Debug payouts for this customer"
                        >
                          Debug
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {Object.keys(getGroupedCustomers()).length === 0 && <p>No customers found</p>}
        
        {/* Debug information for troubleshooting */}
        {process.env.NODE_ENV === 'development' && customers.length > 0 && (
          <div style={{ 
            backgroundColor: '#f8f9fa', 
            border: '1px solid #ddd', 
            borderRadius: '4px', 
            padding: '1rem', 
            marginTop: '1rem',
            fontSize: '0.8rem',
            color: '#666'
          }}>
            <strong>Debug Info:</strong>
            <br />
            Total Customers: {customers.length}
            <br />
                         Actual Deposits: ₹{customers.reduce((sum, customer) => sum + (customer.totalDeposits || 0), 0).toLocaleString()}
             <br />
             Effective Deposits: ₹{customers.reduce((sum, customer) => sum + (customer.effectiveDeposits || 0), 0).toLocaleString()}
            <br />
            Total Payouts: ₹{customers.reduce((sum, customer) => sum + (customer.totalPayouts || 0), 0).toLocaleString()}
            <br />
            Customers with Payouts: {customers.filter(c => c.totalPayouts > 0).length}
            <br />
                         Customers with Deposits: {customers.filter(c => c.totalDeposits > 0).length}
             <br />
             Customers with Default Deposits: {customers.filter(c => c.hasDefaultDeposit).length}
          </div>
        )}
        </div>
      )}
    </div>
  );
}

export default Customers;
