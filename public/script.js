const engineDisplay = document.querySelector('#engineDisplay')
const form = document.querySelector('#form')

const add = document.querySelector('#add')
const remove = document.querySelector('#remove')
const upload = document.querySelector('#upload')

const routinesList = document.querySelector('#routines')
const routinesCount = document.querySelector('#routinesCount')
const routinesUnsaved = document.querySelector('#unsaved')

const memoryList = document.querySelector('#memory')
const memoryCount = document.querySelector('#memoryCount')
const memoryCountMax = 10

let routines, selected, progress, engines, currentEngine

add.addEventListener('click', modify)
remove.addEventListener('click', deleteRoutine)
upload.addEventListener('click', uploadRoutine)

init()

function init()
{
    loadEngines()
    .then(() => loadRoutines())
    .then(() => loadMemory())
    .then(data => renderMemory(data))
    .catch(error => {console.log(error)})
}

function modify()
{
    if(selected < 0)
    {
        routines.push(createRoutineFromForm())
        selected = routines.length - 1
    }
    else
        routines[selected] = createRoutineFromForm()

    progress = true
    render()
}

function deleteRoutine()
{
    if(selected >= 0 && selected < routines.length)
    {
        routines = routines.slice(0, selected).concat(routines.slice(selected + 1, routines.length))
        progress = true
    }

    selected = -1

    render()
}

function selectEngine(id)
{
    currentEngine = findEngine(id)
    render()
}

function loadEngines()
{
    return fetch('scrappers')
    .then(response => response.json())
    .then((data) => 
    {
        if(!data || data < 1) return Promise.reject("No engine found")
        
        engines = data
        renderEngines()
        currentEngine = engines[0]
        return Promise.resolve()
    })
}

function loadRoutines()
{
    return fetch('download')
    .then(response => response.json())
    .then((data) => 
    {
        progress = false
        routines = data
        selected = -1
        render()
        return Promise.resolve()
    })
    .catch(err => 
    {
        routines = []
        selected = -1
        render()
        return Promise.reject(err)
    })
}

function loadMemory()
{
    return fetch('memory')
    .then(response => response.json())
}

function handle(index)
{
    selected = index
    render()
}

function uploadRoutine()
{
    let password = prompt("Enter the master password");

    return fetch('upload', 
    { 
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({pass: cyrb53(password) , data : routines}),
    })
    .then(response => 
    {
        if(response.status == 200)
        {
            alert('Routines updated')
            loadRoutines()
        }
        else if(response.status == 401)
        {
            alert('Bad master password')
        }
    })
    .catch(error => alert('Routines cant be updated - ' + error))
    
}

function render()
{
    routinesCount.textContent = routines.length
    routinesUnsaved.classList.toggle('hidden', !progress)

    routinesList.innerHTML = ''
    routinesList.appendChild(generateNew())

    let iterator = 0
    for (const routine of routines) routinesList.appendChild(generateRoutineDOM(routine, iterator++))
    
    renderForm()
    fillForm()
}

function renderMemory(items)
{

    memoryList.innerHTML = ''
    memoryCount.innerText = items.length > memoryCountMax ? `${memoryCountMax}+` : items.length    

    for(const item of items.reverse().splice(0,memoryCountMax))
    {
        let li = document.createElement('li')
        let a = document.createElement('a')
        li.classList.add('list-group-item')
        a.href = item.url
        li.innerText = item.name
        li.appendChild(document.createElement('br'))
        li.appendChild(createFoundbadge(item))
        li.appendChild(createValueBadge(item))
        li.appendChild(createSentBadge(item))
        a.appendChild(li)
        memoryList.appendChild(a)
    }
}

function renderEngines()
{
    for(const engine of engines)
    {
        let span = document.createElement('span')
        span.classList.add('badge')
        span.classList.add('badge-light')
        span.innerText = ` ${engine.name} `
        engineDisplay.appendChild(span)
        engineDisplay.innerHTML += "&nbsp"
    }
}

function renderForm()
{
    form.innerHTML = ''
    if(currentEngine)
    {
        form.appendChild(renderSelectEngine())
        for(const option of currentEngine.options)
            form.appendChild(renderInputField(option.id, option.name, option.type))
    }
}

function renderSelectEngine()
{
    const div = document.createElement('div')
    const label = document.createElement('label')
    const br = document.createElement('br')
    const select = document.createElement('select')
    const hr = document.createElement('hr')
    label.for = "engine";
    label.innerText = "Search Engine:"
    select.name = "engine"
    select.classList.add('custom-select')
    for(const engine of engines)
    {
        const option = document.createElement('option')
        option.value = engine.id
        option.innerText = engine.name
        select.appendChild(option)
    }
    select.value = currentEngine.id
    select.addEventListener('change', (event) => selectEngine(event.target.value))
    
    div.appendChild(label)
    div.appendChild(br)
    div.appendChild(select)
    div.appendChild(hr)

    return div
}

function renderInputField(id, name, type)
{
    const div = document.createElement('div')
    const label = document.createElement('label')
    const br = document.createElement('br')
    const input = document.createElement('input')
    label.for = id;
    label.innerText = name
    input.type = type;
    input.classList.add('form-control')
    input.name = id;
    input.id = id;
    div.appendChild(label)
    div.appendChild(br)
    div.appendChild(input)
    return div;
}

function createValueBadge(item)
{
    let span = document.createElement('span')
    span.classList.add('badge')
    span.classList.add('badge-info')
    span.innerText = item.price.toString() + ' Ft'
    return span
}

function createSentBadge(item)
{
    let span = document.createElement('span')
    span.classList.add('badge')
    span.classList.add( item.sent ? 'badge-success' : 'badge-primary')
    span.innerText  = item.sent ? 'Sent' : 'In queue'
    return span
}

function createFoundbadge(item)
{
    let span = document.createElement('span')
    span.classList.add('badge')
    span.classList.add('badge-light')
    span.innerText = item.found
    return span
}

function generateRoutineDOM(routine, place)
{
    let li = document.createElement('li')
    
    let engine = document.createElement('span')
    li.classList.add('list-group-item')
    li.classList.add('d-flex')
    li.classList.add('justify-content-between')
    li.classList.add('align-items-center')
    if(selected == place) li.classList.add('active')
    li.addEventListener('click', (event) =>
    {
        const pointer = place
        handle(pointer)
    })

    li.innerText = routine.keywords && routine.keywords != ""  ? routine.keywords : "*"

    if(routine.minPrice && routine.maxPrice)
    {
        let span = document.createElement('span')
        span.classList.add('badge')
        span.classList.add('badge-info')
        span.innerText = `${niceNumber(routine.minPrice)} - ${niceNumber(routine.maxPrice)} Ft`
        li.appendChild(span)
    }


    let engineInfo = findEngine(routine.engine);
    engine.classList.add('badge')
    engine.classList.add(engineInfo ? 'badge-light' : 'badge-danger')
    engine.innerText = `${engineInfo ? engineInfo.name : "Corrupted"}`


    li.appendChild(engine)
    return li
}

function generateNew()
{
    let li = document.createElement('li')
    li.classList.add('list-group-item')
    if(selected < 0) li.classList.add('active')
    li.addEventListener('click', (event) => handle(-1))
    li.innerText = "Create new"
    return li
}

function fillForm()
{
    if(selected < 0)
    {
        console.log(currentEngine.options)   
        const def = (input) => { return currentEngine.options.find(opt => opt.id == input.id)?.default}
        form.querySelectorAll('input').forEach(input => input.value = (def(input) ? def(input) : ''))
    }
    else
    {
        form.querySelectorAll('input').forEach(input => 
        {
            if(input.type === 'checkbox')
                input.checked = routines[selected][input.id]
            else
                input.value = routines[selected][input.id]
        })
    }
}

function createRoutineFromForm()
{
    let routine = {engine : currentEngine.id}
    form.querySelectorAll('input').forEach(input => routine[input.id] = input.type === 'checkbox' ? input.checked : input.value)
    console.log(routine)
    return routine
}

function niceNumber(x) 
{
    return x.toString().replace(/\B(?<!\.\d*)(?=(\d{3})+(?!\d))/g, " ");
}

function findEngine(id)
{
    return engines.find(engine => engine.id == id)
}

function cyrb53(str)
{
    let h1 = 0xdeadbeef ^ 14, h2 = 0x41c6ce57 ^ 14;
    for (let i = 0, ch; i < str.length; i++) 
    {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
    h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1>>>0);
}
