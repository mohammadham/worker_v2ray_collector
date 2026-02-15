
import os

def extract_html():
    with open('worker/worker.js', 'r') as f:
        content = f.read()

    start_marker = "function dashboardHTML(env) {"
    end_marker = "}\n\n// ======== Dashboard API"

    start_idx = content.find(start_marker)
    if start_idx == -1:
        print("Start marker not found")
        return

    # Find the start of the template literal
    template_start = content.find("`", start_idx) + 1
    # Find the end of the template literal
    # We need to find the ` that is followed by ; and then the end_marker or similar
    # In the code it is `\n    `;\n}
    template_end = content.find("`;", template_start)

    html = content[template_start:template_end]

    # The extraction needs to handle the escaped backticks
    # When we read it from the file, it has \`
    # We want to see what the browser will see.
    # The Worker will return this string.
    # So we should simulate the string evaluation.

    # For a simple simulation:
    html = html.replace("\\`", "`").replace("\\$", "$")

    with open('/tmp/dashboard.html', 'w') as f:
        f.write(html)
    print("HTML extracted to /tmp/dashboard.html")

if __name__ == "__main__":
    extract_html()
