from pathlib import Path
import re

app_path=Path('app.js')
app=app_path.read_text(encoding='utf-8')

card=" ['#/dotace','Kč','Dotace a granty','Přehled dotací poskytnutých městskou částí Praha 8 organizacím a dalším příjemcům.'],\n"
finance=" ['#/penize','◒','Finance','Rozpočet, smlouvy, veřejné zakázky a finanční rozhodnutí na jednom místě.'],\n"
if "['#/dotace','Kč','Dotace a granty'" not in app:
    assert finance in app
    app=app.replace(finance,card+finance,1)

grant_item="  {group:'MČ Praha 8',key:'grants',label:'Dotace a granty',count:sourceCount('grants')},\n"
people_item="  {group:'MČ Praha 8',key:'people',label:'Zastupitelstvo a politické kluby',count:sourceCount('people')},\n"
if "key:'grants',label:'Dotace a granty'" not in app:
    assert people_item in app
    app=app.replace(people_item,grant_item+people_item,1)

grant_box="   box('Dotace a granty','Poskytnuté dotace MČ Praha 8. Čerpáme z oficiálního rozcestníku Granty a dotace, historických výsledkových souborů a usnesení. Mimořádné dotace v přehledu tvoří peněžní dary z darovacích smluv, kde je MČ Praha 8 dárcem.','https://www.praha8.cz/Granty-a-dotace.html'),\n"
usneseni_box="   box('Usnesení Rady a Zastupitelstva','Oficiální databáze usnesení MČ Praha 8.','https://www.praha8.cz/app/usn'),\n"
if "box('Dotace a granty'" not in app:
    assert usneseni_box in app
    app=app.replace(usneseni_box,grant_box+usneseni_box,1)
app_path.write_text(app,encoding='utf-8')

grants_path=Path('grants-module.js')
grants=grants_path.read_text(encoding='utf-8')
grants,n=re.subn(r"\n  function ensureHomeCard\(\)\{[\s\S]*?\n  window\.Praha8Grants=", "\n\n  window.Praha8Grants=", grants, count=1)
assert n==1
grants,n=re.subn(r"\n  const schedule=\(\)=>setTimeout\(\(\)=>afterBaseRender\(0\),0\);[\s\S]*?\n\}\)\(\);\s*$", "\n  addEventListener('hashchange',()=>{renderSeq++;grantsPromise=null;});\n})();\n", grants, count=1)
assert n==1
grants_path.write_text(grants,encoding='utf-8')

index_path=Path('index.html')
index=index_path.read_text(encoding='utf-8')
index=re.sub(r'\n\s*<script src="grants-sources-integration\.js\?v=[^"]+" defer></script>','',index)
index=index.replace('app.js?v=2.8.7','app.js?v=2.8.8')
index=index.replace('grants-module.js?v=20260907-1','grants-module.js?v=20260907-2')
index_path.write_text(index,encoding='utf-8')
