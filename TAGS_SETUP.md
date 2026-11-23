# Tags & Family Groups Setup Guide

This guide explains how to set up and use the new Tags and Family Groups functionality in the GGO Ledger CRM.

## Database Setup

1. **Run the Migration**: Execute the `add-tags-support.sql` file in your Supabase SQL Editor to create the necessary tables and default tags.

2. **Tables Created**:
   - `tags`: Stores tag information (name, color)
   - `customer_tags`: Junction table linking customers to tags

3. **Default Tags**: The migration creates several default family tags:
   - Family A (Red)
   - Family B (Green)
   - Family C (Orange)
   - Family D (Purple)
   - Family E (Cyan)
   - VIP (Dark Red)
   - Regular (Dark Green)
   - New (Purple)

## Features

### 1. Tag Management
- **Location**: Navigate to the "Tags" section in the main menu
- **Create Tags**: Add new tags with custom names and colors
- **Edit Tags**: Modify existing tag names and colors
- **Delete Tags**: Remove tags (will also remove them from all customers)

### 2. Customer Tag Assignment
- **Edit Customer**: When editing a customer, you can now assign multiple tags
- **Tag Display**: Tags are shown as colored badges in the customer list
- **Multiple Tags**: Customers can have multiple tags (e.g., "Family A" + "VIP")

### 3. View Modes
- **List View**: Traditional table view with tags displayed as badges
- **Grouped View**: Customers are grouped by their tags, making it easy to see family groups

### 4. Filtering
- **Tag Filter**: Filter customers by specific tags
- **Combined Filtering**: Works with both list and grouped views

## Usage Examples

### Creating Family Groups
1. Go to the "Tags" section
2. Create tags like "Family A", "Family B", etc.
3. Assign appropriate colors to distinguish groups
4. Edit customers and assign them to the appropriate family tags

### Viewing Family Groups
1. Go to the "Customers" section
2. Switch to "Grouped by Tags" view
3. Customers will be organized by their assigned tags
4. Use the tag filter to focus on specific families

### Managing VIP Customers
1. Create a "VIP" tag with a distinctive color
2. Assign this tag to important customers
3. Use the tag filter to quickly view all VIP customers

## Benefits

- **Organized Viewing**: Easily group and view customers by family or category
- **Quick Filtering**: Find specific customer groups instantly
- **Visual Distinction**: Color-coded tags make it easy to identify customer types
- **Flexible Categorization**: Customers can belong to multiple categories
- **Scalable**: Add new tags as your customer base grows

## Technical Notes

- Tags are stored in a separate table with a many-to-many relationship to customers
- Tag colors are customizable using hex color codes
- The system supports unlimited tags per customer
- Tag changes are immediately reflected in all views
- Export functionality includes tag information

## Troubleshooting

- **No Tags Available**: Make sure you've created tags in the Tags section first
- **Tags Not Showing**: Refresh the page or check if the database migration was successful
- **Color Issues**: Ensure color codes are valid hex values (e.g., #FF0000)
