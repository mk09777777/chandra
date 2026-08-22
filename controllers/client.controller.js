const service = require('../services/client.service');

exports.getClients = async (req, res) => {
    try {
      const clients = await service.getClients();
  
      const filteredClients = clients.map(client => ({
        Id: client._id,
        Name: client.Name,
        ImageUrl: client.ImageUrl,
        PriorityOrder: client.PriorityOrder,
        PricingMessageFormat: client.PricingMessageFormat,
        ApplicableStoneTypes: client.ApplicableStoneTypes || [],
      }));
  
      res.json(filteredClients);
    } catch (err) {
      console.error('Error fetching clients:', err);
      res.status(500).json({ error: 'Failed to fetch clients' });
    }
  };
  

exports.getClient = async (req, res) => {
    try {
        const client = await service.getClient(req.params.id);
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }
        res.json(client);
    } catch (err) {
        console.error('Error fetching client:', err); 
        res.status(500).json({ error: 'Failed to fetch client' }); 
    }
};

exports.createClient = async (req, res) => {
    try {
        const client = await service.createClient(req.body);
        res.status(201).json(client);
    } catch (err) {
        console.error('Error creating client:', err);
        res.status(500).json({ error: 'Failed to create client' });
    }
};

exports.updateClient = async (req, res) => {
    try {
        const client = await service.updateClient(req.params.id, req.body);
        res.json(client);
    } catch (err) {
        console.error('Error updating client:', err);
        res.status(500).json({ error: 'Failed to update client' });
    }
};