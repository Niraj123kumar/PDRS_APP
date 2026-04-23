async function createDefenseEvent(accessToken, eventData) {
    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            summary: eventData.summary,
            description: eventData.description,
            start: { dateTime: eventData.start },
            end: { dateTime: eventData.end },
            attendees: (eventData.attendees || []).map((email) => ({ email }))
        })
    });

    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error?.message || 'Failed to create calendar event');
    }

    return {
        eventId: payload.id,
        eventLink: payload.htmlLink
    };
}

async function getUpcomingEvents(accessToken) {
    const params = new URLSearchParams({
        timeMin: new Date().toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '25'
    });
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error?.message || 'Failed to fetch upcoming events');
    }

    return (payload.items || [])
        .filter((event) => /pdrs|defense/i.test(`${event.summary || ''} ${event.description || ''}`))
        .map((event) => ({
            id: event.id,
            summary: event.summary,
            link: event.htmlLink,
            start: event.start?.dateTime || event.start?.date
        }));
}

module.exports = {
    createDefenseEvent,
    getUpcomingEvents
};
